# Catalog quotations

Use the catalog quotation flow when the commercial line must identify a specific approved inventory item. Ordinary and inquiry-derived quotations keep their existing workflow. They do not gain a catalog binding from matching descriptions, UOM, item codes or drawing metadata.

Select an eligible item from the current plant, review its kind, tracking policy and approved revision, then enter the commercial description, quantity and price. Every line in a catalog quotation needs an explicit selection. A SERIAL item needs an integral quantity. The commercial UOM must match the selected item.

Saving captures the selected version and revision. A later item revision or withdrawal can block a fresh commercial transition. Refresh the source and create a deliberate new commercial revision instead of silently replacing the captured item. The earlier snapshot remains historical evidence.

Approval freezes that commercial revision. Acceptance records the authenticated internal customer decision. Conversion creates one native sales order containing the same approved lines and catalog bindings. A repeated exact command uses its retained key; changing the body under that key is a conflict. Follow the visible recovery controls after a lost response before starting a different command.

The captured identity does not reserve stock or authorize production, shipping or billing. Catalog sales orders wait for the later item-aware fulfillment implementation; legacy material and fulfillment writers reject them. No stock availability, delivery commitment or external signature is implied.
