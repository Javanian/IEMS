select order_id from {{ ref('order_balances') }}
where remaining_quantity < 0 or unpaid_amount < 0
 or ordered_quantity <> fulfilled_quantity+remaining_quantity
 or ordered_amount <> deposited_amount+unpaid_amount
