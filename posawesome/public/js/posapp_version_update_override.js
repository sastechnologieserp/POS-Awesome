(() => {
	const isPosAppRoute = () => window.location.pathname.startsWith("/app/posapp");

	const showVersionUpdateDialog = () => {
		const dialog = frappe.msgprint({
			message: __("The application has been updated to a new version, please refresh this page"),
			indicator: "green",
			title: __("Version Updated"),
		});
		dialog.set_primary_action(__("Refresh"), () => {
			location.reload(true);
		});
		dialog.get_close_btn().toggle(false);
	};

	const applyOverride = () => {
		if (!frappe?.realtime) {
			return false;
		}

		frappe.realtime.off("version-update");
		frappe.realtime.on("version-update", () => {
			if (isPosAppRoute()) {
				return;
			}
			showVersionUpdateDialog();
		});

		return true;
	};

	let attempts = 0;
	const maxAttempts = 20;
	const interval = setInterval(() => {
		attempts += 1;
		if (applyOverride() || attempts >= maxAttempts) {
			clearInterval(interval);
		}
	}, 500);
})();
