-- Widen games.win_type for the Bräde win-type vocabulary.
-- The longest value, 'kronspel_dubbelt_munk', is 21 characters and no longer
-- fits the original VARCHAR(20). Apply to existing databases.
ALTER TABLE games ALTER COLUMN win_type TYPE VARCHAR(32);
