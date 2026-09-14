ALTER TABLE payment_attempts
    DROP CONSTRAINT payment_attempts_creator_processing_fee_valid,
    DROP CONSTRAINT payment_attempts_basic_card_fee_valid,
    DROP COLUMN creator_processing_fee_cents,
    DROP COLUMN basic_card_fee_cents;
