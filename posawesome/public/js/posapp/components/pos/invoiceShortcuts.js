import { silentPrint } from "../../plugins/print.js";
import { isOffline } from "../../../offline";
import generateOfflineInvoiceHTML from "../../../offline_print_template";

export default {
	data() {
		return {
			cashDrawerOpening: false, // Flag to track cash drawer opening status
		};
	},

	shortOpenFirstItem(e) {
		if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) {
			try {
				e.preventDefault();
				e.stopPropagation();

				if (!this.items || this.items.length === 0) {
					console.log("No items to expand/collapse");
					return;
				}

				const firstItem = this.items[0];
				console.log("Processing first item:", firstItem.item_code);

				const isExpanded = this.expanded.includes(firstItem.posa_row_id);

				if (isExpanded) {
					console.log("Collapsing item:", firstItem.item_code);
					this.expanded = [];
				} else {
					console.log("Expanding item:", firstItem.item_code);
					this.expanded = [firstItem.posa_row_id];
					this.$nextTick(() => {
						this.update_item_detail(firstItem);
					});
				}
			} catch (error) {
				console.error("Error in shortOpenFirstItem:", error);
				this.eventBus.emit("show_message", {
					title: __("Error toggling item details"),
					color: "error",
				});
			}
		}
	},

	handleExpandedUpdate(newExpanded) {
		console.log("Expanded state updated:", newExpanded);
		this.expanded = newExpanded;

		if (newExpanded && newExpanded.length > 0) {
			const expandedItemId = newExpanded[0];
			const expandedItem = this.items.find((item) => item.posa_row_id === expandedItemId);
			if (expandedItem) {
				this.$nextTick(() => {
					this.update_item_detail(expandedItem);
				});
			}
		}
	},

	shortOpenPayment(e) {
		if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			this.show_payment();
		}
	},

	shortDeleteFirstItem(e) {
		if (e.key === "F10") {
			e.preventDefault();
			this.remove_item(this.items[0]);
		}
	},

	shortDeleteLastItem(e) {
		if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			if (!this.items || this.items.length === 0) {
				this.eventBus.emit("show_message", {
					title: __("No items in cart to remove"),
					color: "warning",
				});
				return;
			}
			const lastItem = this.items[this.items.length - 1];
			this.remove_item(lastItem);
			this.eventBus.emit("show_message", {
				title: __("Last item removed from cart"),
				color: "info",
			});
		}
	},

	shortSelectDiscount(e) {
		console.log("Shortcut pressed:", e.key, e.ctrlKey);
		if (e.key.toLowerCase() === "e" && (e.ctrlKey || e.metaKey)) {
			console.log("Focusing discount field");
			e.preventDefault();
			e.stopPropagation();
			if (this.$refs.discount) {
				this.$refs.discount.focus();
				console.log("Discount field focused");
			} else {
				console.log("Discount field ref not found");
			}
		}
	},



	shortRecallTodaysInvoices(e) {
		if (e.key === "End") {
			e.preventDefault();
			e.stopPropagation();
			this.recallTodaysInvoices();
		}
	},

	shortOpenCashDrawer(e) {
		if (e.key === "Home") {
			e.preventDefault();
			e.stopPropagation();
			this.openCashDrawer();
		}
	},

	async openCashDrawer() {
		try {
			// Prevent multiple simultaneous cash drawer operations
			if (this.cashDrawerOpening) {
				this.eventBus.emit("show_message", {
					title: __("Cash drawer is already opening..."),
					color: "warning"
				});
				return;
			}

			this.cashDrawerOpening = true;

			const result = await frappe.call({
				method: "posawesome.posawesome.api.invoices.open_cash_drawer",
				args: {},
			});

			if (result.message && result.message.success) {
				// Show counter information
				const counter = result.message.counter || 1;
				this.eventBus.emit("show_message", {
					title: __("Opening cash drawer... Counter: {0}", [counter]),
					color: "info"
				});

				// Create a minimal print window for cash drawer with strict controls
				const printWindow = window.open("", "_blank", "width=1,height=1,scrollbars=no,resizable=no,toolbar=no,menubar=no,location=no,status=no");

				// Add additional safeguards to prevent long page issues
				printWindow.document.write(`
					<!DOCTYPE html>
					<html>
					<head>
						<title>Cash Drawer Print</title>
						<style>
							/* Additional safeguards for printing */
							@page {
								size: 80mm 60mm;
								margin: 0;
								padding: 0;
							}
							body {
								margin: 0;
								padding: 0;
								width: 80mm;
								height: 60mm;
								overflow: hidden;
							}
						</style>
					</head>
					<body>
						${result.message.html_content}
					</body>
					</html>
				`);
				printWindow.document.close();

				// Wait for content to load, then print and close immediately
				printWindow.addEventListener('load', () => {
					// Set a timeout to ensure content is fully rendered
					setTimeout(() => {
						try {
							// Force focus and print
							printWindow.focus();
							printWindow.print();

							// Close the window after a very short delay
							setTimeout(() => {
								if (!printWindow.closed) {
									printWindow.close();
								}
							}, 500);
						} catch (printError) {
							console.warn("Print failed:", printError);
							if (!printWindow.closed) {
								printWindow.close();
							}
						}
					}, 200);
				});

				// Fallback: if load event doesn't fire, close after reasonable timeout
				setTimeout(() => {
					if (!printWindow.closed) {
						printWindow.close();
					}
				}, 5000);

				// Success message with counter
				setTimeout(() => {
					this.eventBus.emit("show_message", {
						title: __("Cash drawer opened successfully! Counter: {0}", [counter]),
						color: "success"
					});
				}, 1000);

			} else {
				this.eventBus.emit("show_message", {
					title: __("Failed to open cash drawer"),
					color: "error"
				});
			}
		} catch (error) {
			console.error("Cash drawer error:", error);
			this.eventBus.emit("show_message", {
				title: __("Error opening cash drawer"),
				color: "error"
			});
		} finally {
			// Reset the flag after a delay to prevent rapid clicking
			setTimeout(() => {
				this.cashDrawerOpening = false;
			}, 2000);
		}
	},

	/**
	 * F6 Shortcut: Cash payment and print
	 * This shortcut should always use silent printing for better cashier experience
	 * as it allows cashiers to handle more customers without waiting for print dialogs
	 */
	shortCashPaymentAndPrint(e) {
		if (e.key === "F6") {
			console.log("F6 key pressed - triggering cash payment and print");
			console.log("This shortcut should use silent printing for better cashier experience");
			e.preventDefault();
			e.stopPropagation();
			this.cashPaymentAndPrint();
		}
	},

	shortEditQuantityF7(e) {
		// Check for F7 key more robustly
		const isF7 = e.key === "F7" ||
			e.keyCode === 118 ||
			e.which === 118 ||
			(e.type === "keydown" && e.code === "F7");

		if (isF7) {
			// Don't prevent if user is typing in an input field (unless it's a special case)
			const activeElement = document.activeElement;
			const isInputFocused = activeElement && (
				activeElement.tagName === "INPUT" ||
				activeElement.tagName === "TEXTAREA" ||
				activeElement.isContentEditable ||
				(activeElement.tagName === "DIV" && activeElement.getAttribute("contenteditable") === "true")
			);

			// Allow F7 to work even when inputs are focused (for better UX)
			// But prevent it if user is actively editing in a prompt/dialog
			if (isInputFocused && activeElement.closest('.frappe-dialog')) {
				return; // Don't interfere with dialog inputs
			}

			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();

			// F7: Edit quantity of first item
			this.editQuantity();
			return false;
		}
	},

	shortOpenPaymentF4(e) {
		if (e.key === "F4" || e.keyCode === 115 || e.which === 115) {
			e.preventDefault();
			e.stopPropagation();

			// F4: Open payment dialog (moved from Ctrl+S)
			this.show_payment();
		}
	},

	shortEditPrice(e) {
		if (e.key === "/") {
			e.preventDefault();
			e.stopPropagation();
			this.editPrice();
		}
	},

	shortEditQuantity(e) {
		if (e.key === "F8") {
			e.preventDefault();
			e.stopPropagation();
			this.editQuantity();
		}
	},

	shortSubmitAndPrintFromPayment(e) {
		if (e.key === "F5") {
			e.preventDefault();
			e.stopPropagation();
			// F5: Submit and print when in payment page
			this.eventBus.emit("submit_with_print");
		}
	},

	shortShowShortcutsHelp(e) {
		if (e.key === "F1") {
			e.preventDefault();
			e.stopPropagation();
			this.showShortcutsHelp();
		}
	},

	showShortcutsHelp() {
		const shortcuts = [
			{
				category: "🎯 Quick Actions",
				shortcuts: [
					{ key: "F1", description: "Show this shortcuts help dialog" },
					{ key: "F4", description: "Open payment dialog" },
					{ key: "F6", description: "Quick cash payment → submit → print" },
					{ key: "F7", description: "Edit quantity of first item" },
					{ key: "F5", description: "Submit and print when payment page is open" },
					{ key: "End", description: "Recall today's invoices with Return/Print options" }
				]
			},
			{
				category: "📝 Item Management",
				shortcuts: [
					{ key: "/", description: "Edit price of first item" },
					{ key: "F7", description: "Edit quantity of first item (popup)" },
					{ key: "Ctrl+A", description: "Toggle expand/collapse first item details" },
					{ key: "F10", description: "Delete first item from invoice" },
					{ key: "Ctrl+Z", description: "Remove last added item from cart" }
				]
			},
			{
				category: "💰 Payment & Invoice",
				shortcuts: [
					{ key: "F4", description: "Open payment dialog" },
					{ key: "Ctrl+E", description: "Focus discount field" },
					{ key: "Ctrl+X", description: "Submit payment (when in payment screen)" }
				]
			},
			{
				category: "🖨️ Printing & Receipts",
				shortcuts: [
					{ key: "F6", description: "Auto-print after cash payment" },
					{ key: "F5", description: "Submit and print when payment page is open" },
					{ key: "End → Print", description: "Print any today's invoice" }
				]
			},
			{
				category: "💾 Invoice Management",
				shortcuts: [
					{ key: "End → Return", description: "Load any today's invoice back to POS" },
					{ key: "Hold Button", description: "Save current invoice as draft and clear" },
					{ key: "Release Button", description: "Load previously saved draft invoices" }
				]
			}
		];

		let helpContent = `
			<div style="max-height: 70vh; overflow-y: auto; font-family: Arial, sans-serif;">
				<div style="text-align: center; margin-bottom: 20px; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px;">
					<h2 style="margin: 0; font-size: 24px;">🎯 POS Awesome Keyboard Shortcuts</h2>
					<p style="margin: 5px 0 0 0; opacity: 0.9;">Master your POS workflow with these powerful shortcuts</p>
				</div>
		`;

		shortcuts.forEach(category => {
			helpContent += `
				<div style="margin-bottom: 25px; background: #f8f9fa; border-radius: 8px; padding: 15px; border-left: 4px solid #667eea;">
					<h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">${category.category}</h3>
					<div style="display: grid; gap: 8px;">
			`;

			category.shortcuts.forEach(shortcut => {
				helpContent += `
					<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: white; border-radius: 6px; border: 1px solid #e9ecef;">
						<span style="font-weight: bold; color: #495057; min-width: 120px; text-align: center; padding: 4px 8px; background: #e9ecef; border-radius: 4px; font-family: 'Courier New', monospace;">${shortcut.key}</span>
						<span style="color: #6c757d; margin-left: 15px;">${shortcut.description}</span>
					</div>
				`;
			});

			helpContent += `
					</div>
				</div>
			`;
		});

		helpContent += `
				<div style="margin-top: 20px; padding: 15px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px;">
					<h4 style="margin: 0 0 10px 0; color: #856404;">💡 Pro Tips:</h4>
					<ul style="margin: 0; padding-left: 20px; color: #856404;">
						<li>Use <strong>F6</strong> for quick cash transactions</li>
						<li>Use <strong>F7</strong> to submit and print current invoice</li>
						<li>Use <strong>F5</strong> to submit and print when payment page is open</li>
						<li>Press <strong>End</strong> to find and reprint today's invoices</li>
						<li>Use <strong>/</strong> and <strong>F8</strong> to quickly edit first item</li>
						<li>Hold invoices for later with the <strong>Hold</strong> button</li>
					</ul>
				</div>
			</div>
		`;

		const dialog = frappe.msgprint({
			title: __("POS Awesome Keyboard Shortcuts"),
			message: helpContent,
			primary_action: {
				label: __("Got it!"),
				action: () => dialog.hide(),
			},
			secondary_action: {
				label: __("Print Shortcuts"),
				action: () => this.printShortcutsHelp(),
			},
		});
	},

	printShortcutsHelp() {
		const shortcuts = [
			{ key: "F1", description: "Show shortcuts help" },
			{ key: "F4", description: "Open payment dialog" },
			{ key: "F6", description: "Quick cash payment → submit → print" },
			{ key: "F7", description: "Edit quantity of first item" },
			{ key: "F5", description: "Submit and print when payment page is open" },
			{ key: "Home", description: "Open cash drawer" },
			{ key: "End", description: "Recall today's invoices" },
			{ key: "/", description: "Edit price of first item" },
			{ key: "Ctrl+A", description: "Toggle first item details" },
			{ key: "F10", description: "Delete first item" },
			{ key: "Ctrl+Z", description: "Remove last added item" },
			{ key: "Ctrl+E", description: "Focus discount field" },
			{ key: "Ctrl+X", description: "Submit payment" }
		];

		let printContent = `
			<html>
			<head>
				<title>POS Awesome Shortcuts</title>
				<style>
					body { font-family: Arial, sans-serif; margin: 20px; }
					.header { text-align: center; margin-bottom: 30px; }
					.shortcut { margin: 10px 0; padding: 10px; border: 1px solid #ccc; }
					.key { font-weight: bold; background: #f0f0f0; padding: 5px 10px; border-radius: 3px; }
					.description { margin-left: 10px; }
					.category { margin: 20px 0; font-weight: bold; font-size: 18px; }
				</style>
			</head>
			<body>
				<div class="header">
					<h1>🎯 POS Awesome Keyboard Shortcuts</h1>
					<p>Master your POS workflow with these powerful shortcuts</p>
				</div>
		`;

		shortcuts.forEach(shortcut => {
			printContent += `
				<div class="shortcut">
					<span class="key">${shortcut.key}</span>
					<span class="description">${shortcut.description}</span>
				</div>
			`;
		});

		printContent += `
				<div style="margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
					<h3>💡 Pro Tips:</h3>
					<ul>
						<li>Use F4 for quick cash transactions</li>
						<li>Use F6 to submit and print current invoice</li>
						<li>Press End to find and reprint today's invoices</li>
						<li>Use / and . to quickly edit first item</li>
						<li>Hold invoices for later with the Hold button</li>
					</ul>
				</div>
			</body>
			</html>
		`;

		const printWindow = window.open('', '_blank');
		printWindow.document.write(printContent);
		printWindow.document.close();
		printWindow.print();
	},



	async recallTodaysInvoices() {
		try {
			if (!this.pos_profile || !this.pos_profile.company) {
				this.eventBus.emit("show_message", {
					title: __("Please select a POS profile first"),
					color: "warning",
				});
				return;
			}

			const result = await frappe.call({
				method: "posawesome.posawesome.api.invoices.get_todays_invoices",
				args: {
					company: this.pos_profile.company,
					user: frappe.session.user,
				},
			});

			if (result.message && result.message.length > 0) {
				this.showInvoiceSelectionDialog(result.message);
			} else {
				this.eventBus.emit("show_message", {
					title: __("No invoices found for today"),
					color: "info",
				});
			}
		} catch (error) {
			console.error("Error recalling today's invoices:", error);
			this.eventBus.emit("show_message", {
				title: __("Error recalling invoices"),
				color: "error",
			});
		}
	},

	showInvoiceSelectionDialog(invoices) {
		const dialog = frappe.msgprint({
			title: __("Select Invoice to Recall"),
			message: `
				<div style="max-height: 400px; overflow-y: auto;">
					${invoices.map((invoice, index) => `
						<div style="padding: 12px; border: 1px solid #ddd; margin-bottom: 12px; border-radius: 6px; background: #f9f9f9;">
							<div style="font-weight: bold; font-size: 14px; margin-bottom: 4px;">${invoice.name}</div>
							<div style="font-size: 12px; color: #666; margin-bottom: 4px;">Customer: ${invoice.customer_name || invoice.customer}</div>
							<div style="font-size: 12px; color: #666; margin-bottom: 8px;">Date: ${invoice.posting_date} - Total: ${this.formatCurrency(invoice.grand_total)}</div>
							<div style="margin-bottom: 8px;">
								<strong style="font-size: 12px;">Items:</strong>
								<div style="margin-left: 10px; font-size: 11px; color: #555;">
									${invoice.items ? invoice.items.slice(0, 5).map(item =>
				`<div>• ${item.item_name || item.item_code} (Qty: ${item.qty}) - ${this.formatCurrency(item.amount)}</div>`
			).join('') : '<div>No items found</div>'}
									${invoice.items && invoice.items.length > 5 ? `<div style="color: #999;">... and ${invoice.items.length - 5} more items</div>` : ''}
								</div>
							</div>
							<div style="margin-top: 8px;">
								<button onclick="window.recallInvoice('${invoice.name}')" style="background: #4CAF50; color: white; border: none; padding: 6px 12px; margin-right: 6px; cursor: pointer; border-radius: 4px;">Return</button>
								<button onclick="window.printInvoice('${invoice.name}')" style="background: #2196F3; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px;">Print</button>
							</div>
						</div>
					`).join('')}
				</div>
			`,
			primary_action: {
				label: __("Close"),
				action: () => dialog.hide(),
			},
		});

		window.recallInvoice = (invoiceName) => {
			this.loadInvoiceByName(invoiceName);
			dialog.hide();
		};

		window.printInvoice = (invoiceName) => {
			this.printInvoiceByName(invoiceName);
		};
	},

	async loadInvoiceByName(invoiceName) {
		try {
			const result = await frappe.call({
				method: "frappe.client.get",
				args: {
					doctype: "Sales Invoice",
					name: invoiceName,
				},
			});

			if (result.message) {
				this.load_invoice(result.message);
				this.eventBus.emit("show_message", {
					title: __("Invoice loaded successfully"),
					color: "success",
				});
			}
		} catch (error) {
			console.error("Error loading invoice:", error);
			this.eventBus.emit("show_message", {
				title: __("Error loading invoice"),
				color: "error",
			});
		}
	},

	async printInvoiceByName(invoiceName) {
		try {
			const offline = isOffline();
			console.log("==========================================");
			console.log("printInvoiceByName called for invoice:", invoiceName);
			console.log("POS Profile:", this.pos_profile);
			console.log("posa_silent_print setting:", this.pos_profile.posa_silent_print);
			console.log("IS OFFLINE:", offline);
			console.log("==========================================");

			// Check if we're offline - use offline template
			if (offline) {
				console.log("POS is OFFLINE - using offline template");
				try {
					// For offline printing, we need to get the invoice data from the current session
					// Since this is called after submission, we'll use the invoice_doc if available
					if (this.invoice_doc && this.invoice_doc.name === invoiceName) {
						console.log("Using current invoice_doc for offline printing");
						this.printOfflineInvoiceWithSalesPOSFormat(this.invoice_doc);
					} else {
						console.log("Invoice doc not available, showing offline message");
						this.eventBus.emit("show_message", {
							title: __("Invoice printed offline"),
							color: "success",
						});
					}
					return;
				} catch (offlineError) {
					console.warn("Offline printing failed:", offlineError);
					this.eventBus.emit("show_message", {
						title: __("Offline printing failed"),
						color: "warning",
					});
					return;
				}
			}

			// ========== ONLINE PRINTING - USE SALES POS FORMAT ==========
			console.log("POS is ONLINE - using SALES POS print format from server");
			// ALWAYS use SALES POS format for online printing
			const print_format = this.pos_profile.print_format || "SALES POS";
			const letter_head = this.pos_profile.letter_head || 0;
			const url =
				frappe.urllib.get_base_url() +
				"/printview?doctype=Sales%20Invoice&name=" +
				invoiceName +
				"&trigger_print=1" +
				"&format=" +
				print_format +
				"&no_letterhead=" +
				letter_head;

			console.log("Print URL:", url);
			console.log("Opening print window - will print IMMEDIATELY");

			// Open print window and print immediately
			const printWindow = window.open(url, "_blank");

			// Print immediately when loaded
			printWindow.addEventListener(
				"load",
				function () {
					console.log("Print window loaded - printing now");
					printWindow.print();
				},
				{ once: true },
			);

			this.eventBus.emit("show_message", {
				title: __("Printing invoice"),
				color: "success",
			});
		} catch (error) {
			console.error("Error printing invoice:", error);
			this.eventBus.emit("show_message", {
				title: __("Error printing invoice"),
				color: "error",
			});
		}
	},

	/**
	 * Print invoice using SALES POS print format when POS is offline
	 * This uses the same format as the online printing but works offline
	 */
	printOfflineInvoiceWithSalesPOSFormat(invoice) {
		if (!invoice) {
			console.warn("No invoice provided for offline printing");
			return;
		}

		try {
			console.log("Using SALES POS print format for offline printing...");

			// Use the same print format as online but with the offline invoice data
			// The SALES POS format is defined in the POS Profile print_format setting
			const print_format = this.pos_profile.print_format || "POS Print";
			const letter_head = this.pos_profile.letter_head || 0;

			// Create a data URL with the invoice data for offline printing
			const printData = {
				doctype: "Sales Invoice",
				name: invoice.name,
				format: print_format,
				no_letterhead: letter_head,
				// Include all the invoice data needed for the template
				invoice_data: invoice
			};

			console.log("Opening SALES POS print window...");

			// For offline printing, we'll create a simplified version that mimics the SALES POS format
			// Since we can't use the server-side Jinja2 template, we'll create a client-side version
			const html = this.generateSalesPOSHTML(invoice);

			const win = window.open("", "_blank");
			win.document.write(html);
			win.document.close();
			win.focus();

			// Auto-print after a short delay to ensure content is loaded
			setTimeout(() => {
				console.log("Triggering SALES POS offline print...");
				win.print();
			}, 500);

			console.log("SALES POS offline invoice printed successfully");
		} catch (error) {
			console.error("Error in SALES POS offline printing:", error);
			this.eventBus.emit("show_message", {
				title: __("Error printing offline invoice"),
				color: "error",
			});
		}
	},

	/**
	 * Generate HTML that matches the SALES POS print format
	 * This replicates the server-side template for offline use
	 */
	generateSalesPOSHTML(invoice) {
		if (!invoice) return "";

		// Generate items rows
		const itemsRows = (invoice.items || [])
			.map((item) => {
				return `
					<tr>
						<td colspan="4">${item.item_name}<br>
						<div style="text-align:right;">
						${item.item_name}</div></td>
					</tr>
					<tr>
						<td>${item.barcode || item.item_code}</td>
						<td>${item.qty}</td>
						<td>${this.formatCurrency(item.rate)}</td>
						<td>${this.formatCurrency(item.amount)}</td>
					</tr>
				`;
			})
			.join("");

		// Generate payments info
		const paymentsInfo = (invoice.payments || [])
			.map((payment) => `Payment Method: ${payment.mode_of_payment}`)
			.join("<br>");

		// Calculate change amount
		const changeAmount = (invoice.paid_amount || 0) - (invoice.grand_total || 0);

		const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Invoice ${invoice.name || ""}</title>
	<style>
		@import url('http://fonts.cdnfonts.com/css/vcr-osd-mono');
		body {
			font-family: 'VCR OSD Mono';
			color: #000;
			text-align:center;
			display: flex;
			justify-content: center;
			font-size: 10px;
		}
		.address {
			line-height: 100%;
		}
		.brand {
			font-size:20px;
		}
		.print-format td, .print-format th {
			padding:3px!important;
		}
		.address {
			margin-top:0px;
		}
		.bill{
			width: 80mm;
			margin: 5 5 5 auto;
			box-shadow: 0 0 3px #aaa;
			padding: 10px 10px;
			box-sizing: border-box;
		}
		.flex {
			display: flex;
		}
		.justify-between {
			justify-content: space-between;
		}
		.table{
			border-collapse: collapse;
			width: 100%;
		}
		.table .header{
			border-top: 3px dashed #000;
			border-bottom: 3px dashed #000;
		}
		th {
			color:black!important;
		}
		td {
			color:black!important;
		}
		.table {
			text-align: left;
		}
		.table .total td {
			border-top: 2px dashed #000;
			border-bottom: 2px dashed #000;
		}
		.table .net-amount td:first-of-type {
			border-top: none;
		}
		.table .net-amount td {
			border-top: 2px dashed #000;
		}
		.table .net-amount{
			border-bottom: 2px dashed #000;
		}
		@media print {
			.hidden-print,
			.hidden-print * {
				display: none !important;
			}
		}
	</style>
</head>
<body>
	<div class="bill">
		<div class="brand">
			<img src="/files/YeshFresh_LOGO.PNG" alt="Company Logo" height="100px" width="280px"><br>
			<b>
				<!--سوق فلامينجو سوبر ماركت المركزي-->
			</b>
		</div>
		<div class="address">
			Salmiya, Block 10, Saba Street
			<br>Phone No. : 60628166
		</div>
		<div class="invoice"><b>CASH INVOICE </b></div>
		<div class="bill-details">
			<div class="flex justify-between">
				<div>Invoice No: ${invoice.name}</div>
			</div>
			<div class="flex justify-between">
				<div>Date: ${invoice.posting_date || ""}</div>
				<div>Time: ${invoice.posting_time || ""}</div>
			</div>
		</div>
		<table class="table" width="100%">
			<tr class="header">
				<th width="30%" class="td2">
					Item &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
					الإ سم
				</th> 
				<th width="22%" class="td2">
					Qty &nbsp;
					الكمية
				</th> 
				<th width="22%" class="td2">
					U/P &nbsp; &nbsp;
					س\\ و
				</th>
				<th width="26%" class="td2">
					Amount
					المجموع
				</th>
			</tr>
			${itemsRows}
		</table>
		<table class="table" width="100%">
			<tr class="total">
				<td>Total</td>
				<td>المجموع</td>
				<td></td>
				<td></td>
				<td>${this.formatCurrency(invoice.total)}</td>
			</tr>
			${invoice.discount_amount ? `
			<tr>
				<td>Discount</td>
				<td>تخفيض</td>
				<td></td>
				<td></td>
				<td>${this.formatCurrency(invoice.discount_amount)}</td>
			</tr>
			` : ""}
			<tr class="net-amount">
				<td>Net Amount</td>
				<td colspan="3">
					المجموع الإجمالي
				</td>
				<td>${this.formatCurrency(invoice.rounded_total)}</td>
			</tr>
			<tr>
				<td>Paid Amount</td>
				<td colspan="3">
					المبلغ المدفوع
				</td>
				<td>${this.formatCurrency(invoice.paid_amount)}</td>
			</tr>
			<tr class="net-amount">
				<td colspan="5" style="font-size:20; text-align: center;"><b>Change Cash (${this.formatCurrency(changeAmount)})</b></td>
			</tr>
		</table>
		
		${paymentsInfo}<br>
		Username: ${invoice.pos_profile || ""} [Biller] <br>
		Thank You ! Please visit again
	</div>
</body>
</html>`;

		return html;
	},

	/**
	 * Format currency values for display
	 */
	formatCurrency(amount) {
		if (amount === null || amount === undefined) return "0.00";
		return parseFloat(amount).toFixed(2);
	},

	/**
	 * F4 Shortcut: Direct cash payment and print
	 * 
	 * This method handles the complete invoice submission process:
	 * 1. Validates all required data (items, customer, POS shift, profile)
	 * 2. Uses the same invoice processing as show_payment() for consistency
	 * 3. Sets cash payment to the correct amount based on server-calculated totals
	 * 4. Submits invoice directly to backend
	 * 5. Prints invoice automatically
	 * 6. Clears invoice for next use
	 */
	async cashPaymentAndPrint() {
		try {
			console.log("cashPaymentAndPrint method called - direct submission mode");
			if (!this.items || this.items.length === 0) {
				this.eventBus.emit("show_message", {
					title: __("Please add items to the invoice first"),
					color: "warning",
				});
				return;
			}

			if (!this.customer) {
				this.eventBus.emit("show_message", {
					title: __("Please select a customer first"),
					color: "warning",
				});
				return;
			}

			if (!this.pos_opening_shift || !this.pos_opening_shift.name) {
				this.eventBus.emit("show_message", {
					title: __("No active POS shift found. Please start a POS shift first."),
					color: "error",
				});
				return;
			}

			if (this.pos_opening_shift.status !== "Open") {
				this.eventBus.emit("show_message", {
					title: __("POS shift is not open. Please start a new POS shift first."),
					color: "error",
				});
				return;
			}

			if (!this.pos_profile || !this.pos_profile.name) {
				this.eventBus.emit("show_message", {
					title: __("No POS profile found. Please select a POS profile first."),
					color: "error",
				});
				return;
			}

			if (this.pos_opening_shift.pos_profile !== this.pos_profile.name) {
				this.eventBus.emit("show_message", {
					title: __("POS shift is not for the same POS profile. Please start a new POS shift."),
					color: "error",
				});
				return;
			}

			if (this.pos_opening_shift.company !== this.pos_profile.company) {
				this.eventBus.emit("show_message", {
					title: __("POS shift is not for the same company. Please start a new POS shift."),
					color: "error",
				});
				return;
			}

			console.log("All validations passed - preparing invoice using same method as show_payment()");

			// USE THE SAME METHOD AS show_payment() FOR CONSISTENCY
			let invoice_doc;
			if (
				this.invoiceType === "Order" &&
				this.pos_profile.posa_create_only_sales_order &&
				!this.new_delivery_date &&
				!this.invoice_doc.posa_delivery_date
			) {
				console.log("Building local Sales Order doc for payment");
				invoice_doc = this.get_invoice_doc();
			} else if (this.invoice_doc.doctype == "Sales Order" && this.invoiceType === "Invoice") {
				console.log("Processing Sales Order payment");
				invoice_doc = await this.process_invoice_from_order();
			} else {
				console.log("Processing regular invoice");
				invoice_doc = this.process_invoice();
			}

			if (!invoice_doc) {
				console.log("Failed to process invoice");
				this.eventBus.emit("show_message", {
					title: __("Error processing invoice"),
					color: "error",
				});
				return;
			}

			// Update totals on the client side to use proper rounding (same as show_payment)
			invoice_doc.total = this.Total;
			invoice_doc.grand_total = this.subtotal;

			if (this.pos_profile.disable_rounded_total) {
				invoice_doc.rounded_total = this.flt(this.subtotal, this.currency_precision);
			} else {
				invoice_doc.rounded_total = this.roundAmount(this.subtotal);
			}
			invoice_doc.base_total = this.Total * (1 / this.exchange_rate || 1);
			invoice_doc.base_grand_total = this.subtotal * (1 / this.exchange_rate || 1);
			if (this.pos_profile.disable_rounded_total) {
				invoice_doc.base_rounded_total = this.flt(invoice_doc.base_grand_total, this.currency_precision);
			} else {
				invoice_doc.base_rounded_total = this.roundAmount(invoice_doc.base_grand_total);
			}

			// Check if this is a return invoice (same logic as show_payment)
			if (this.isReturnInvoice || invoice_doc.is_return) {
				console.log("Preparing RETURN invoice for payment with:", {
					is_return: invoice_doc.is_return,
					invoiceType: this.invoiceType,
					return_against: invoice_doc.return_against,
					items: invoice_doc.items.length,
					grand_total: invoice_doc.grand_total,
				});

				// For return invoices, explicitly ensure all amounts are negative
				invoice_doc.is_return = 1;
				if (invoice_doc.grand_total > 0) invoice_doc.grand_total = -Math.abs(invoice_doc.grand_total);
				if (invoice_doc.rounded_total > 0)
					invoice_doc.rounded_total = -Math.abs(invoice_doc.rounded_total);
				if (invoice_doc.total > 0) invoice_doc.total = -Math.abs(invoice_doc.total);
				if (invoice_doc.base_grand_total > 0)
					invoice_doc.base_grand_total = -Math.abs(invoice_doc.base_grand_total);
				if (invoice_doc.base_rounded_total > 0)
					invoice_doc.base_rounded_total = -Math.abs(invoice_doc.base_rounded_total);
				if (invoice_doc.base_total > 0) invoice_doc.base_total = -Math.abs(invoice_doc.base_total);

				// Ensure all items have negative quantity and amount
				if (invoice_doc.items && invoice_doc.items.length) {
					invoice_doc.items.forEach((item) => {
						if (item.qty > 0) item.qty = -Math.abs(item.qty);
						if (item.stock_qty > 0) item.stock_qty = -Math.abs(item.stock_qty);
						if (item.amount > 0) item.amount = -Math.abs(item.amount);
					});
				}
			}

			// Get payments with correct sign (positive/negative) - same as show_payment
			invoice_doc.payments = this.get_payments();
			console.log("Generated payments:", invoice_doc.payments);

			// Double-check return invoice payments are negative
			if ((this.isReturnInvoice || invoice_doc.is_return) && invoice_doc.payments.length) {
				invoice_doc.payments.forEach((payment) => {
					if (payment.amount > 0) payment.amount = -Math.abs(payment.amount);
					if (payment.base_amount > 0) payment.base_amount = -Math.abs(payment.base_amount);
				});
				console.log("Ensured negative payment amounts for return:", invoice_doc.payments);
			}

			// Set up cash payment for the full amount based on server-calculated totals
			if (invoice_doc.payments && invoice_doc.payments.length) {
				const cashPayment = invoice_doc.payments.find(p =>
					p.mode_of_payment && p.mode_of_payment.toLowerCase().includes("cash")
				);

				if (cashPayment) {
					// Use client-side calculated totals with proper rounding
					let finalPaymentAmount;
					if (this.pos_profile.disable_rounded_total) {
						// No rounding: use grand_total
						finalPaymentAmount = this.flt(invoice_doc.grand_total, this.currency_precision);
					} else {
						// With rounding: use rounded_total
						finalPaymentAmount = this.roundAmount(invoice_doc.grand_total);
					}

					console.log("Setting cash payment using client-calculated totals:");
					console.log("- grand_total (client):", invoice_doc.grand_total);
					console.log("- rounded_total (client):", invoice_doc.rounded_total);
					console.log("- disable_rounded_total:", this.pos_profile.disable_rounded_total);
					console.log("- final payment amount:", finalPaymentAmount);

					cashPayment.amount = finalPaymentAmount;
					cashPayment.base_amount = finalPaymentAmount;
					cashPayment.default = 1;

					// FINAL VERIFICATION: Ensure no outstanding amount
					const expectedOutstanding = invoice_doc.grand_total - finalPaymentAmount;
					console.log("Final verification - no outstanding amount:");
					console.log("- grand_total (server):", invoice_doc.grand_total);
					console.log("- cash_payment:", finalPaymentAmount);
					console.log("- expected_outstanding:", expectedOutstanding);
					console.log("- Should be 0 or negative (change):", expectedOutstanding <= 0 ? "✅" : "❌");
				}
			}

			console.log("Invoice prepared using client-side method, submitting directly...");
			console.log("Final invoice amounts (from client):");
			console.log("- grand_total:", invoice_doc.grand_total);
			console.log("- rounded_total:", invoice_doc.rounded_total);
			console.log("- disable_rounded_total:", this.pos_profile.disable_rounded_total);
			console.log("- write_off_amount:", invoice_doc.write_off_amount);
			console.log("- paid_amount:", invoice_doc.paid_amount);
			console.log("- cash payment amount:", invoice_doc.payments ? invoice_doc.payments.find(p => p.default)?.amount : "No cash payment");

			// Submit the invoice directly without opening payment dialog
			frappe.call({
				method: "posawesome.posawesome.api.invoices.submit_invoice",
				args: {
					data: {
						total_change: 0,
						paid_change: 0,
						credit_change: 0,
						redeemed_customer_credit: 0,
						customer_credit_dict: [],
						is_cashback: true
					},
					invoice: invoice_doc
				},
				callback: (r) => {
					if (r.message && r.message.name) {
						// Print the invoice immediately
						this.printInvoiceByName(r.message.name);

						this.eventBus.emit("show_message", {
							title: __("Invoice {0} submitted and printed", [r.message.name]),
							color: "success",
						});

						// Clear the invoice for next use
						this.eventBus.emit("clear_invoice");

						// Focus on item search after print
						this.$nextTick(() => {
							const itemSearchRef = this.$parent?.$refs?.items_selector?.$refs?.debounce_search;
							if (itemSearchRef) {
								itemSearchRef.focus();
							}
						});
					} else {
						this.eventBus.emit("show_message", {
							title: __("Invoice submitted but print failed"),
							color: "warning",
						});
					}
				},
				error: (r) => {
					console.error("Error submitting invoice:", r);
					this.eventBus.emit("show_message", {
						title: __("Error submitting invoice"),
						color: "error",
					});
				}
			});

		} catch (error) {
			console.error("Error in cashPaymentAndPrint:", error);
			this.eventBus.emit("show_message", {
				title: __("Error processing cash payment"),
				color: "error",
				message: error.message,
			});
		}
	},



	/**
	 * F6 Shortcut: Direct submit and print current invoice
	 * 
	 * This method handles the complete invoice submission process:
	 * 1. Validates all required data (items, customer, POS shift, profile)
	 * 2. Creates invoice document with current items and amounts
	 * 3. Sets up proper payment structure
	 * 4. Submits invoice directly to backend
	 * 5. Prints invoice automatically
	 * 6. Clears invoice for next use
	 */
	async submitAndPrintDirect() {
		try {

			// Validate required data
			if (!this.items || this.items.length === 0) {
				this.eventBus.emit("show_message", {
					title: __("Please add items to the invoice first"),
					color: "warning",
				});
				return;
			}

			if (!this.customer) {
				this.eventBus.emit("show_message", {
					title: __("Please select a customer first"),
					color: "warning",
				});
				return;
			}

			if (!this.pos_opening_shift || !this.pos_opening_shift.name) {
				this.eventBus.emit("show_message", {
					title: __("No active POS shift found. Please start a POS shift first."),
					color: "error",
				});
				return;
			}

			if (this.pos_opening_shift.status !== "Open") {
				this.eventBus.emit("show_message", {
					title: __("POS shift is not open. Please start a new POS shift first."),
					color: "error",
				});
				return;
			}

			if (!this.pos_profile || !this.pos_profile.name) {
				this.eventBus.emit("show_message", {
					title: __("No POS profile found. Please select a POS profile first."),
					color: "error",
				});
				return;
			}

			if (this.pos_opening_shift.pos_profile !== this.pos_profile.name) {
				this.eventBus.emit("show_message", {
					title: __("POS shift is not for the same POS profile. Please start a new POS shift."),
					color: "error",
				});
				return;
			}

			if (this.pos_opening_shift.company !== this.pos_profile.company) {
				this.eventBus.emit("show_message", {
					title: __("POS shift is not for the same company. Please start a new POS shift."),
					color: "error",
				});
				return;
			}

			// Calculate totals from current items
			const netTotal = this.items.reduce((sum, item) => {
				return sum + (item.amount || (item.rate * item.qty) || 0);
			}, 0);

			// Add delivery charges if applicable
			const totalWithDelivery = netTotal + (this.delivery_charges_rate || 0);

			// Calculate tax amount if applicable
			const taxAmount = this.total_tax || 0;

			// Calculate grand total
			const grandTotal = totalWithDelivery + taxAmount;

			// Round the total to currency precision
			const roundedTotal = this.flt(grandTotal, this.currency_precision || 2);

			// Prepare the invoice document
			const invoiceDoc = {
				doctype: "Sales Invoice",
				customer: this.customer,
				items: this.items.map(item => ({
					...item,
					doctype: "Sales Invoice Item"
				})),
				net_total: netTotal,
				total: totalWithDelivery,
				grand_total: grandTotal,
				rounded_total: roundedTotal,
				base_net_total: netTotal,
				base_total: totalWithDelivery,
				base_grand_total: grandTotal,
				base_rounded_total: roundedTotal,
				total_taxes_and_charges: taxAmount,
				base_total_taxes_and_charges: taxAmount,
				currency: this.selected_currency || this.pos_profile?.currency || "KWD",
				company: this.pos_profile?.company || "Yes Fresh",
				conversion_rate: this.conversion_rate || 1,
				plc_conversion_rate: this.exchange_rate || 1,
				price_list_currency: this.price_list_currency || this.pos_profile?.currency || "KWD",
				is_pos: 1,
				posa_pos_opening_shift: this.pos_opening_shift?.name,
				pos_profile: this.pos_profile?.name,
				posting_date: this.posting_date_display ? this.formatDateForBackend(this.posting_date_display) : frappe.datetime.nowdate(),
				due_date: this.posting_date_display ? this.formatDateForBackend(this.posting_date_display) : frappe.datetime.nowdate(),
				update_stock: 1,
				ignore_pricing_rule: 1,
				posa_is_printed: 1,
				paid_amount: roundedTotal,
				base_paid_amount: roundedTotal,
				discount_amount: this.discount_amount || 0,
				base_discount_amount: this.discount_amount || 0,
				additional_discount_percentage: this.additional_discount_percentage || 0,
				additional_discount_amount: this.additional_discount_amount || 0
			};

			// Set up payments - cash payment for the full amount
			if (this.pos_profile && this.pos_profile.payments) {
				invoiceDoc.payments = this.pos_profile.payments.map(payment => ({
					...payment,
					amount: 0,
					base_amount: 0
				}));

				const cashPayment = invoiceDoc.payments.find(p =>
					p.mode_of_payment && p.mode_of_payment.toLowerCase().includes("cash")
				);
				if (cashPayment) {
					cashPayment.amount = roundedTotal;
					cashPayment.base_amount = roundedTotal;
					cashPayment.default = 1;
				}
			}

			// Add delivery charges if applicable
			if (this.delivery_charges_rate > 0) {
				invoiceDoc.delivery_charges = this.delivery_charges_rate;
				invoiceDoc.base_delivery_charges = this.delivery_charges_rate;
			}



			// Submit the invoice directly
			frappe.call({
				method: "posawesome.posawesome.api.invoices.submit_invoice",
				args: {
					data: {
						total_change: 0,
						paid_change: 0,
						credit_change: 0,
						redeemed_customer_credit: 0,
						customer_credit_dict: [],
						is_cashback: true
					},
					invoice: invoiceDoc
				},
				callback: (r) => {
					if (r.message && r.message.name) {
						// Print the invoice immediately
						this.printInvoiceByName(r.message.name);

						this.eventBus.emit("show_message", {
							title: __("Invoice {0} submitted and printed", [r.message.name]),
							color: "success",
						});

						// Clear the invoice for next use
						this.eventBus.emit("clear_invoice");

						// Focus on item search after print
						this.$nextTick(() => {
							const itemSearchRef = this.$parent?.$refs?.items_selector?.$refs?.debounce_search;
							if (itemSearchRef) {
								itemSearchRef.focus();
							}
						});
					} else {
						this.eventBus.emit("show_message", {
							title: __("Invoice submitted but print failed"),
							color: "warning",
						});
					}
				},
				error: (r) => {
					console.error("Error submitting invoice:", r);
					this.eventBus.emit("show_message", {
						title: __("Error submitting invoice"),
						color: "error",
					});
				}
			});

		} catch (error) {
			this.eventBus.emit("show_message", {
				title: __("Error processing invoice submission"),
				color: "error",
			});
		}
	},

	editPrice() {
		if (this.items && this.items.length > 0) {
			const firstItem = this.items[0];

			if (!this.expanded.includes(firstItem.posa_row_id)) {
				this.expanded = [firstItem.posa_row_id];
			}

			this.$nextTick(() => {
				setTimeout(() => {
					const priceInput = document.querySelector('#rate input, input[id="rate"]');
					if (priceInput) {
						priceInput.focus();
						priceInput.select();
					} else {
						this.eventBus.emit("show_message", {
							title: __("Price field not found. Please expand the item first."),
							color: "warning",
						});
					}
				}, 100);
			});
		} else {
			this.eventBus.emit("show_message", {
				title: __("No items to edit"),
				color: "warning",
			});
		}
	},

	editQuantity(targetItem = null) {
		const item = targetItem || (this.items && this.items.length > 0 ? this.items[0] : null);
		if (!item) {
			this.eventBus.emit("show_message", { title: __("No items to edit"), color: "warning" });
			return;
		}

		const defaultQty = this.isReturnInvoice ? Math.abs(item.qty || 1) : (item.qty || 1);

		const dialog = new frappe.ui.Dialog({
			title: __("Update Quantity"),
			fields: [
				{
					fieldname: "qty",
					fieldtype: "Float",
					label: __("Enter new quantity for {0}", [item.item_name || item.item_code]),
					default: defaultQty,
					reqd: 1,
				},
				{
					fieldname: "keypad",
					fieldtype: "HTML",
				},
			],
			primary_action_label: __("Update"),

			// ✅ Arrow function fixes the warning
			primary_action: (values) => {
				const newQty = parseFloat(values.qty);

				if (!isNaN(newQty) && newQty > 0) {
					const appliedQty = this.isReturnInvoice ? -Math.abs(newQty) : newQty;
					item.qty = appliedQty;
					item.amount = (item.rate || 0) * appliedQty;
					item.base_amount = item.amount;

					if (this.calcStockQty) {
						this.calcStockQty(item, appliedQty);
					}

					this.$forceUpdate();
					this.eventBus.emit("show_message", {
						title: __("Quantity updated to {0}", [appliedQty]),
						color: "success",
					});

					dialog.hide();
				} else {
					this.eventBus.emit("show_message", {
						title: __("Invalid quantity value"),
						color: "error",
					});
				}

				this.eventBus.emit("refocus_item_search");
			},
		});

		// Numeric keypad UI
		const keypadHTML = `
		<div class="numeric-keypad">
			<div class="keypad-row">
				<button class="btn btn-primary btn-lg key">1</button>
				<button class="btn btn-primary btn-lg key">2</button>
				<button class="btn btn-primary btn-lg key">3</button>
			</div>
			<div class="keypad-row">
				<button class="btn btn-primary btn-lg key">4</button>
				<button class="btn btn-primary btn-lg key">5</button>
				<button class="btn btn-primary btn-lg key">6</button>
			</div>
			<div class="keypad-row">
				<button class="btn btn-primary btn-lg key">7</button>
				<button class="btn btn-primary btn-lg key">8</button>
				<button class="btn btn-primary btn-lg key">9</button>
			</div>
			<div class="keypad-row">
				<button class="btn btn-secondary btn-lg key">.</button>
				<button class="btn btn-secondary btn-lg key">0</button>
				<button class="btn btn-danger btn-lg key clear">C</button>
			</div>
		</div>
	`;

		dialog.fields_dict.keypad.$wrapper.html(keypadHTML);

		// Keypad click handling
		dialog._keypadStarted = false;
		dialog._pendingDecimal = false;

		dialog.fields_dict.keypad.$wrapper.on("click", ".key", (e) => {
			const key = (e.currentTarget && e.currentTarget.innerText) || "";
			const field = dialog.get_field("qty");
			
			if (key === "C") {
				field.set_value("");
				dialog._pendingDecimal = false;
				dialog._keypadStarted = false;
			} else if (key === ".") {
				dialog._pendingDecimal = true;
				dialog._keypadStarted = true;
			} else {
				// On first key press start from empty value
				if (!dialog._keypadStarted) {
					field.set_value(`${key}`);
					dialog._keypadStarted = true;
				} else {
					const current = field.get_value() || "";
					if (dialog._pendingDecimal) {
						field.set_value(`${current}.${key}`);
						dialog._pendingDecimal = false;
					} else {
						field.set_value(`${current}${key}`);
					}
				}
			}
		});

		dialog.show();
	},

	formatDateForBackend(date) {
		if (!date) return null;
		if (typeof date === "string") {
			if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
				return date;
			}
			if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(date)) {
				const [d, m, y] = date.split("-");
				return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
			}
		}
		const d = new Date(date);
		if (!isNaN(d.getTime())) {
			const year = d.getFullYear();
			const month = `0${d.getMonth() + 1}`.slice(-2);
			const day = `0${d.getDate()}`.slice(-2);
			return `${year}-${month}-${day}`;
		}
		return date;
	},
};
