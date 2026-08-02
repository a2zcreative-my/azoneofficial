-- v1.4.118: proof of the claim payout — the CEO attaches the bank-transfer
-- slip after Mark paid, closing the loop: staff receipt in, approval chain,
-- payment out, proof stored. No FKs by policy.
ALTER TABLE claims ADD COLUMN payment_proof_key TEXT;
