# Review one manufactured unit

Open the company stock receipt from the production job or an authorized company-stock link. In **Manufactured unit trace**, select the actual serial and choose **Load manufactured unit trace**. No serial or receipt is inferred from a description.

The first evidence sections show the purchased materials attributed to that output. A terminal V2 output also shows the exact manufactured component identities attributed to it, with their purchased-material attribution. **Current restriction scope** explains the wider batch-level hold set. A receipt appearing in that wider set is not, by itself, proof that its material entered the selected unit.

Review the downstream categories separately. Reservation and issue show commitments before final attribution. Consumed material awaiting attribution does not yet identify an output. An output candidate retains its actual serial and QC state; process loss has no output identity. Abandoned reservations are history only.

Use **Refresh manufactured unit trace** after later production or quality activity. A connection or access error hides the previous trace until a new complete read succeeds. A limit or evidence-integrity error does not return a partial investigation result. Follow the relevant authorized source records for review.

This investigation does not create a hold, complete a recall, authorize dispatch or make a terminal output reusable. Existing permission-controlled hold/release commands remain separate. Links to production and purchased-receipt details require their respective read permissions.
