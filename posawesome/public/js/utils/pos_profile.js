export async function ensurePosProfile() {
	const bootProfile = frappe?.boot?.pos_profile;
	if (bootProfile && bootProfile.warehouse && bootProfile.selling_price_list) {
		return bootProfile;
	}
	try {
		const res = await frappe.call({
			method: "posawesome.posawesome.api.utils.get_active_pos_profile",
			args: { user: frappe.session.user },
		});
		if (res.message) {
			frappe.boot.pos_profile = res.message;
			return res.message;
		}
	} catch (e) {
		console.error("Failed to fetch active POS profile", e);
	}
	return bootProfile || null;
}
