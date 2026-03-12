import frappe


@frappe.whitelist()
def item_history(item_code,customer = None):
	
	if not customer:
		frappe.throw("Please select the customer")
			
	data = frappe.db.sql("""
		SELECT
			si.cost_center,
			si.posting_date,
			sii.qty,
			sii.rate,
			sii.amount
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si
		ON sii.parent = si.name
		WHERE
			sii.item_code = %s
			AND si.customer = %s
			AND si.docstatus = 1
		ORDER BY si.posting_time DESC
		LIMIT 10
	""", (item_code,customer), as_dict=True)

	return data