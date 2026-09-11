-- Public profiles are separate from private account credentials. New accounts
-- are viewers until publishing a profile or creating a show.
CREATE TABLE creator_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
    bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 500),
    avatar_url TEXT NOT NULL DEFAULT '' CHECK (char_length(avatar_url) <= 2048),
    cover_url TEXT NOT NULL DEFAULT '' CHECK (char_length(cover_url) <= 2048),
    category TEXT NOT NULL DEFAULT 'Just chatting' CHECK (category IN ('Just chatting','Music','Gaming','Creative','Tech')),
    published BOOLEAN NOT NULL DEFAULT false,
    follower_count BIGINT NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
    is_live BOOLEAN NOT NULL DEFAULT false,
    live_show_id UUID REFERENCES shows(id) ON DELETE SET NULL,
    live_started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_document TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', username || ' ' || display_name || ' ' || bio)
    ) STORED
);
CREATE INDEX creator_directory_rank ON creator_profiles(is_live DESC, follower_count DESC, user_id DESC) WHERE published;
CREATE INDEX creator_directory_category_rank ON creator_profiles(category, is_live DESC, follower_count DESC, user_id DESC) WHERE published;
CREATE INDEX creator_directory_search ON creator_profiles USING GIN(search_document) WHERE published;
INSERT INTO creator_profiles(user_id,username,display_name,published,is_live,live_show_id,live_started_at)
SELECT u.id,u.username,u.username,true,s.id IS NOT NULL,s.id,s.started_at
FROM users u LEFT JOIN shows s ON s.creator_id=u.id AND s.status='LIVE';

CREATE FUNCTION initialize_social_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO creator_profiles(user_id,username,display_name) VALUES(NEW.id,NEW.username,NEW.username);
    RETURN NEW;
END $$;
CREATE TRIGGER users_social_profile AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION initialize_social_profile();

CREATE TABLE creator_follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES creator_profiles(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(follower_id,creator_id),
    CHECK (follower_id <> creator_id)
);
CREATE INDEX creator_followers_page ON creator_follows(creator_id,created_at DESC,follower_id DESC);
CREATE INDEX creator_following_page ON creator_follows(follower_id,created_at DESC,creator_id DESC);
-- Distributed over 64 rows per creator instead of a single hot counter row.
CREATE TABLE creator_follower_shards (
    creator_id UUID NOT NULL REFERENCES creator_profiles(user_id) ON DELETE CASCADE,
    shard SMALLINT NOT NULL CHECK (shard BETWEEN 0 AND 63),
    count BIGINT NOT NULL CHECK (count >= 0),
    PRIMARY KEY(creator_id,shard)
);
CREATE TABLE social_dirty_creators (
    creator_id UUID PRIMARY KEY REFERENCES creator_profiles(user_id) ON DELETE CASCADE,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX social_dirty_age ON social_dirty_creators(queued_at,creator_id);
-- Shared locks let concurrent writers coexist while excluding a worker's delete.
-- Retry after a worker deletes a row between INSERT and SELECT: never lose dirtiness.
CREATE FUNCTION mark_social_dirty(target UUID) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    LOOP
        INSERT INTO social_dirty_creators(creator_id)
        SELECT target WHERE EXISTS(SELECT 1 FROM creator_profiles WHERE user_id=target)
        ON CONFLICT DO NOTHING;
        PERFORM 1 FROM social_dirty_creators WHERE creator_id=target FOR KEY SHARE;
        EXIT WHEN FOUND;
        EXIT WHEN NOT EXISTS(SELECT 1 FROM creator_profiles WHERE user_id=target);
    END LOOP;
END $$;
CREATE FUNCTION update_follow_shard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; actor UUID; bucket SMALLINT;
BEGIN
    IF TG_OP='INSERT' THEN target:=NEW.creator_id; actor:=NEW.follower_id;
    ELSE target:=OLD.creator_id; actor:=OLD.follower_id; END IF;
    bucket := (get_byte(decode(replace(actor::text,'-',''),'hex'),0) % 64)::smallint;
    IF TG_OP='INSERT' THEN
        INSERT INTO creator_follower_shards(creator_id,shard,count) VALUES(target,bucket,1)
        ON CONFLICT(creator_id,shard) DO UPDATE SET count=creator_follower_shards.count+1;
    ELSE
        UPDATE creator_follower_shards SET count=GREATEST(0,count-1) WHERE creator_id=target AND shard=bucket;
    END IF;
    PERFORM mark_social_dirty(target);
    RETURN NULL;
END $$;
CREATE TRIGGER follows_count AFTER INSERT OR DELETE ON creator_follows FOR EACH ROW EXECUTE FUNCTION update_follow_shard();

-- Durable fanout-on-read event log: going live is O(1), regardless of followers.
CREATE TABLE creator_live_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    creator_id UUID NOT NULL REFERENCES creator_profiles(user_id) ON DELETE CASCADE,
    show_id UUID NOT NULL UNIQUE REFERENCES shows(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX creator_live_events_inbox ON creator_live_events(creator_id,created_at DESC,id DESC);
CREATE INDEX creator_live_events_retention ON creator_live_events(created_at,id);
CREATE TABLE notification_reads (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id BIGINT NOT NULL REFERENCES creator_live_events(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,event_id)
);
CREATE INDEX notification_reads_event ON notification_reads(event_id);

CREATE FUNCTION project_social_show() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        PERFORM mark_social_dirty(NEW.creator_id);
        IF NEW.status='LIVE' THEN
            UPDATE creator_profiles SET published=true,is_live=true,live_show_id=NEW.id,
                live_started_at=NEW.started_at,updated_at=clock_timestamp() WHERE user_id=NEW.creator_id;
            INSERT INTO creator_live_events(creator_id,show_id) VALUES(NEW.creator_id,NEW.id) ON CONFLICT(show_id) DO NOTHING;
        ELSIF NEW.status='ENDED' THEN
            UPDATE creator_profiles SET is_live=false,live_show_id=NULL,live_started_at=NULL,
                updated_at=clock_timestamp() WHERE user_id=NEW.creator_id AND live_show_id=NEW.id;
        ELSIF TG_OP='INSERT' THEN
            UPDATE creator_profiles SET published=true,updated_at=clock_timestamp() WHERE user_id=NEW.creator_id;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER shows_social_projection AFTER INSERT OR UPDATE OF status ON shows FOR EACH ROW EXECUTE FUNCTION project_social_show();
