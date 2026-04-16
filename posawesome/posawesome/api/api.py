import frappe


@frappe.whitelist()
def item_history(item_code,customer = None):
	
	if not customer:
		frappe.throw("Please select the customer")
			
	data = frappe.db.sql("""
		SELECT
			si.cost_center,
			si.modified,
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
		ORDER BY si.modified DESC, si.posting_date DESC, si.posting_time DESC
		LIMIT 20
	""", (item_code,customer), as_dict=True)

	return data


@frappe.whitelist()
def item_stock_by_warehouse(item_code, company=None):
	if not item_code:
		frappe.throw("Item code is required")

	query = """
		SELECT
			w.name AS warehouse,
			COALESCE(b.actual_qty, 0) AS actual_qty
		FROM `tabWarehouse` w
		LEFT JOIN `tabBin` b
			ON b.warehouse = w.name
			AND b.item_code = %s
		WHERE IFNULL(w.is_group, 0) = 0
	"""
	params = [item_code]

	if company:
		query += " AND w.company = %s"
		params.append(company)

	query += " ORDER BY w.name ASC"

	return frappe.db.sql(query, tuple(params), as_dict=True)