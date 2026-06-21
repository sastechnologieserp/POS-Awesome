export default {
	data() {
		return {
			float_precision: 2,
			currency_precision: 2,
			posa_qty_has_decimal: false,
		};
	},
	methods: {
		flt(value, precision, number_format, rounding_method) {
			if (!precision && precision != 0) {
				precision = this.currency_precision || 2;
			}
			if (!rounding_method) {
				rounding_method = "Banker's Rounding (legacy)";
			}
			return flt(value, precision, number_format, rounding_method);
		},
		formatCurrency(value, precision) {
			if (value === null || value === undefined) {
				value = 0;
			}
			let number = Number(String(value).replace(/,/g, ""));
			if (isNaN(number)) number = 0;
			let prec = precision != null ? Number(precision) : Number(this.currency_precision) || 2;
			// Clamp precision to the valid range 0-20 to avoid RangeError
			if (!Number.isInteger(prec) || prec < 0 || prec > 20) {
				prec = Math.min(Math.max(parseInt(prec) || 2, 0), 20);
			}
			return number.toLocaleString("en-US", {
				minimumFractionDigits: prec,
				maximumFractionDigits: prec,
			});
		},
		formatFloat(value, precision) {
			if (value === null || value === undefined) {
				value = 0;
			}
			let number = Number(String(value).replace(/,/g, ""));
			if (isNaN(number)) number = 0;
			let prec = precision != null ? Number(precision) : Number(this.float_precision) || 2;
			// Clamp precision to the valid range 0-20 to avoid RangeError
			if (!Number.isInteger(prec) || prec < 0 || prec > 20) {
				prec = Math.min(Math.max(parseInt(prec) || 2, 0), 20);
			}
			
			if (this.posa_qty_has_decimal) {
				return number.toLocaleString("en-US", {
					minimumFractionDigits: 0,
					maximumFractionDigits: prec,
				});
			}

			return number.toLocaleString("en-US", {
				minimumFractionDigits: prec,
				maximumFractionDigits: prec,
			});
		},
		setFormatedCurrency(el, field_name, precision, no_negative = false, $event) {
			let input_val = $event && $event.target ? $event.target.value : $event;
			if (typeof input_val === "string") {
				input_val = input_val.replace(/,/g, "");
			}
			let value = parseFloat(input_val);
			if (isNaN(value)) {
				value = 0;
			} else if (no_negative && value < 0) {
				value = Math.abs(value);
			}
			if (typeof el === "object") {
				el[field_name] = value;
			} else {
				this[field_name] = value;
			}
			return this.formatCurrency(value, precision);
		},
		setFormatedFloat(el, field_name, precision, no_negative = false, $event) {
			let input_val = $event && $event.target ? $event.target.value : $event;
			if (typeof input_val === "string") {
				input_val = input_val.replace(/,/g, "");
			}
			let value = parseFloat(input_val);
			if (isNaN(value)) {
				value = 0;
			} else if (no_negative && value < 0) {
				value = Math.abs(value);
			}
			if (typeof el === "object") {
				el[field_name] = value;
			} else {
				this[field_name] = value;
			}
			return this.formatFloat(value, precision);
		},
		currencySymbol(currency) {
			return get_currency_symbol(currency);
		},
		isNumber(value) {
			const pattern = /^-?(\d+|\d{1,3}(\.\d{3})*)(,\d+)?$/;
			return pattern.test(value) || "invalid number";
		},
	},
	mounted() {
		this.float_precision = frappe.defaults.get_default("float_precision") || 2;
		this.currency_precision = frappe.defaults.get_default("currency_precision") || 2;

		// Load saved precision from localStorage for offline usage
		try {
			const saved = typeof localStorage !== "undefined" ? localStorage.getItem("posawesome_currency_precision") : null;
			const savedPrec = saved != null ? parseInt(saved) : NaN;
			console.log("format.js - loading precision from localStorage:", saved, "parsed as:", savedPrec);
			if (!isNaN(savedPrec)) {
				this.float_precision = savedPrec;
				this.currency_precision = savedPrec;
				console.log("format.js - precision set to:", this.currency_precision);
			}
		} catch (e) {
			// ignore localStorage errors
			console.log("format.js - localStorage error:", e);
		}

		try {
			const savedQtyDec = typeof localStorage !== "undefined" ? localStorage.getItem("posawesome_qty_has_decimal") : null;
			if (savedQtyDec !== null) {
				this.posa_qty_has_decimal = savedQtyDec === "1";
			}
		} catch (e) {}

		const updatePrecision = (data) => {
			const profile = data.pos_profile || data;
			const prec = parseInt(profile.posa_decimal_precision);
			if (!isNaN(prec)) {
				this.float_precision = prec;
				this.currency_precision = prec;
				// Persist precision for offline mode
				try {
					if (typeof localStorage !== "undefined") {
						localStorage.setItem("posawesome_currency_precision", String(prec));
					}
				} catch (e) {
					// ignore localStorage errors
				}
			}

			if (profile && profile.posa_qty_has_decimal !== undefined) {
				this.posa_qty_has_decimal = !!profile.posa_qty_has_decimal;
				try {
					if (typeof localStorage !== "undefined") {
						localStorage.setItem("posawesome_qty_has_decimal", String(this.posa_qty_has_decimal ? 1 : 0));
					}
				} catch (e) {}
			}
		};

		if (this.eventBus && this.eventBus.on) {
			this.eventBus.on("register_pos_profile", updatePrecision);
			this.eventBus.on("payments_register_pos_profile", updatePrecision);
		}
	},
};
