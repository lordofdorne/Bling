ALTER TABLE payment_attempts
    ADD COLUMN basic_card_fee_cents BIGINT,
    ADD COLUMN creator_processing_fee_cents BIGINT,
    ADD CONSTRAINT payment_attempts_basic_card_fee_valid CHECK (
        basic_card_fee_cents IS NULL OR basic_card_fee_cents >= 0
    ),
    ADD CONSTRAINT payment_attempts_creator_processing_fee_valid CHECK (
        creator_processing_fee_cents IS NULL OR (
            creator_processing_fee_cents >= 0
            AND basic_card_fee_cents IS NOT NULL
            AND creator_processing_fee_cents <= basic_card_fee_cents
        )
    );

COMMENT ON COLUMN payment_attempts.platform_fee_cents IS
    'Total withheld from creator earnings: platform revenue share plus creator half of the snapshotted basic card fee.';
COMMENT ON COLUMN payment_attempts.basic_card_fee_cents IS
    'Published basic domestic card fee snapshotted when the payment attempt is created.';
COMMENT ON COLUMN payment_attempts.creator_processing_fee_cents IS
    'Creator half of the basic card fee; Bling absorbs any odd cent.';
