import { useParams } from "react-router-dom";
import { useLiveShow } from "../lib/shows";

export function PublicHotline() {
  const { username = "" } = useParams();
  const liveShow = useLiveShow(username.toLowerCase());

  if (liveShow.isPending) {
    return (
      <main className="page centered">
        <div className="status">Checking the Hotline…</div>
      </main>
    );
  }
  if (liveShow.isError) {
    return (
      <main className="page centered">
        <div className="form-error" role="alert">
          Unable to load this Hotline. Please try again.
        </div>
      </main>
    );
  }
  if (!liveShow.data) {
    return (
      <main className="page centered">
        <p className="eyebrow">@{username}</p>
        <h1>Hotline is currently closed.</h1>
        <p className="lede">Come back when this creator is live.</p>
      </main>
    );
  }
  return (
    <main className="page centered">
      <div className="live-badge">
        <span /> Live now
      </div>
      <p className="eyebrow">@{username}</p>
      <h1>The Hotline is open.</h1>
      <p className="lede">
        The caller queue arrives in the next delivery slice.
      </p>
    </main>
  );
}
