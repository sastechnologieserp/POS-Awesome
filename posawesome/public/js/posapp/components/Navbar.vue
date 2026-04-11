<template>
	<nav>
		<!-- Use the modular NavbarAppBar component -->
		<NavbarAppBar
			:pos-profile="posProfile"
			:pending-invoices="pendingInvoices"
			:is-dark="isDark"
			@nav-click="handleNavClick"
			@go-desk="goDesk"
			@show-offline-invoices="showOfflineInvoices = true"
			@show-petty-cash-pay-in="showPettyCashPayIn = true"
			@show-petty-cash-pay-out="showPettyCashPayOut = true"
			@open-cash-drawer="openCashDrawerFromNavbar"
		>
			<!-- Slot for status indicator -->
			<template #status-indicator>
				<StatusIndicator
					:network-online="networkOnline"
					:server-online="serverOnline"
					:server-connecting="serverConnecting"
					:is-ip-host="isIpHost"
					:sync-totals="syncTotals"
				/>
			</template>

			<!-- Slot for cache usage meter -->
			<template #cache-usage-meter>
				<CacheUsageMeter
					:cache-usage="cacheUsage"
					:cache-usage-loading="cacheUsageLoading"
					:cache-usage-details="cacheUsageDetails"
					@refresh="refreshCacheUsage"
				/>
			</template>

			<!-- Slot for menu -->
			<template #menu>
				<NavbarMenu
					:pos-profile="posProfile"
					:last-invoice-id="lastInvoiceId"
					:manual-offline="manualOffline"
					:network-online="networkOnline"
					:server-online="serverOnline"
					:is-dark="isDark"
					@close-shift="openCloseShift"
					@print-last-invoice="printLastInvoice"
					@sync-invoices="syncPendingInvoices"
					@toggle-offline="toggleManualOffline"
					@clear-cache="clearCache"
					@show-about="showAboutDialog = true"
					@toggle-theme="toggleTheme"
					@logout="logOut"
					@show-shortcuts="handleShowShortcuts"
					@recall-invoices="handleRecallInvoices"
				/>
			</template>
		</NavbarAppBar>

		<!-- Use the modular NavbarDrawer component -->
		<NavbarDrawer
			v-model:drawer="drawer"
			v-model:item="item"
			:company="company"
			:company-img="companyImg"
			:items="items"
			:is-dark="isDark"
			@change-page="changePage"
		/>

		<!-- Use the modular AboutDialog component -->
		<AboutDialog v-model="showAboutDialog" />

		<!-- Keep existing dialogs -->
		<v-dialog v-model="freeze" persistent max-width="290">
			<v-card>
				<v-card-title class="text-h5">{{ freezeTitle }}</v-card-title>
				<v-card-text>{{ freezeMsg }}</v-card-text>
				<v-card-actions>
					<v-spacer></v-spacer>
					<v-btn color="primary" @click="freeze = false">OK</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Petty Cash Pay In Dialog -->
		<v-dialog v-model="showPettyCashPayIn" persistent max-width="400">
			<v-card>
				<v-card-title class="text-h5 text-center">
					<v-icon color="success" class="mr-2">mdi-cash-plus</v-icon>
					{{ __("Pay In") }}
				</v-card-title>
				<v-card-text>
					<v-form ref="pettyCashPayInForm">
						<v-text-field
							v-model="pettyCashData.amount"
							:label="__('Amount')"
							type="number"
							:rules="[v => !!v || __('Amount is required'), v => v > 0 || __('Amount must be positive')]"
							required
							prepend-icon="mdi-currency-usd"
						></v-text-field>
						<v-textarea
							v-model="pettyCashData.note"
							:label="__('Note')"
							rows="3"
							:rules="[v => !!v || __('Note is required')]"
							required
							prepend-icon="mdi-note-text"
						></v-textarea>
					</v-form>
				</v-card-text>
				<v-card-actions>
					<v-spacer></v-spacer>
					<v-btn color="grey" @click="closePettyCashPayIn">
						{{ __("Cancel") }}
					</v-btn>
					<v-btn color="success" @click="submitPettyCashPayIn" :loading="pettyCashSubmitting">
						{{ __("Submit") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Petty Cash Pay Out Dialog -->
		<v-dialog v-model="showPettyCashPayOut" persistent max-width="400">
			<v-card>
				<v-card-title class="text-h5 text-center">
					<v-icon color="warning" class="mr-2">mdi-cash-minus</v-icon>
					{{ __("Pay Out") }}
				</v-card-title>
				<v-card-text>
					<v-form ref="pettyCashPayOutForm">
						<v-text-field
							v-model="pettyCashData.amount"
							:label="__('Amount')"
							type="number"
							:rules="[v => !!v || __('Amount is required'), v => v > 0 || __('Amount must be positive')]"
							required
							prepend-icon="mdi-currency-usd"
						></v-text-field>
						<v-textarea
							v-model="pettyCashData.note"
							:label="__('Note')"
							rows="3"
							:rules="[v => !!v || __('Note is required')]"
							required
							prepend-icon="mdi-note-text"
						></v-textarea>
					</v-form>
				</v-card-text>
				<v-card-actions>
					<v-spacer></v-spacer>
					<v-btn color="grey" @click="closePettyCashPayOut">
						{{ __("Cancel") }}
					</v-btn>
					<v-btn color="warning" @click="submitPettyCashPayOut" :loading="pettyCashSubmitting">
						{{ __("Submit") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<OfflineInvoicesDialog
			v-model="showOfflineInvoices"
			:pos-profile="posProfile"
			@deleted="updateAfterDelete"
			@sync-all="syncPendingInvoices"
		/>

		<!-- Snackbar for notifications -->
		<v-snackbar v-model="snack" :timeout="snackTimeout" :color="snackColor" location="top right">
			{{ snackText }}
			<template v-slot:actions>
				<v-btn color="white" variant="text" @click="snack = false">{{ __("Close") }}</v-btn>
			</template>
		</v-snackbar>
	</nav>
</template>

<script>
import NavbarAppBar from "./navbar/NavbarAppBar.vue";
import NavbarDrawer from "./navbar/NavbarDrawer.vue";
import NavbarMenu from "./navbar/NavbarMenu.vue";
import StatusIndicator from "./navbar/StatusIndicator.vue";
import CacheUsageMeter from "./navbar/CacheUsageMeter.vue";
import AboutDialog from "./navbar/AboutDialog.vue";
import OfflineInvoices from "./OfflineInvoices.vue";
import { forceClearAllCache } from "../../offline/cache.js";
import { clearAllCaches } from "../../utils/clearAllCaches.js";
import { isOffline } from "../../offline/index.js";

export default {
	name: "NavBar",
	components: {
		NavbarAppBar,
		NavbarDrawer,
		NavbarMenu,
		StatusIndicator,
		CacheUsageMeter,
		AboutDialog,
		OfflineInvoicesDialog: OfflineInvoices,
	},
	props: {
		posProfile: {
			type: Object,
			default: () => ({}),
		},
		pendingInvoices: {
			type: Number,
			default: 0,
		},
		lastInvoiceId: String,
		networkOnline: Boolean,
		serverOnline: Boolean,
		serverConnecting: Boolean,
		isIpHost: Boolean,
		syncTotals: {
			type: Object,
			default: () => ({ pending: 0, synced: 0, drafted: 0 }),
		},
		manualOffline: Boolean,
		isDark: Boolean,
		cacheUsage: {
			type: Number,
			default: 0,
		},
		cacheUsageLoading: {
			type: Boolean,
			default: false,
		},
		cacheUsageDetails: {
			type: Object,
			default: () => ({ total: 0, indexedDB: 0, localStorage: 0 }),
		},
	},
	data() {
		return {
			drawer: false,
			mini: true,
			item: 0,
			items: [
				{ text: "POS", icon: "mdi-network-pos" },
				{ text: "Payments", icon: "mdi-credit-card" },
			],
			company: "POS Awesome",
			companyImg: "/assets/posawesome/js/posapp/components/pos/pos.png",
			showAboutDialog: false,
			showOfflineInvoices: false,
			showPettyCashPayIn: false,
			showPettyCashPayOut: false,
			pettyCashData: {
				amount: "",
				note: "",
				entry_type: "",
				pos_shift: "",
				pos_profile: ""
			},
			pettyCashSubmitting: false,
			freeze: false,
			freezeTitle: "",
			freezeMsg: "",
			snack: false,
			snackText: "",
			snackColor: "success",
			snackTimeout: 3000,
			cashDrawerOpening: false, // New flag to track cash drawer opening status
		};
	},
	computed: {
		appBarColor() {
			return this.isDark ? this.$vuetify.theme.themes.dark.colors.surface : "white";
		},
	},
	mounted() {
		this.initializeNavbar();

		if (this.eventBus) {
			this.eventBus.on("show_message", this.showMessage);
			this.eventBus.on("freeze", this.handleFreeze);
			this.eventBus.on("unfreeze", this.handleUnfreeze);
			this.eventBus.on("set_company", this.handleSetCompany);
		}
	},
	unmounted() {
		if (this.eventBus) {
			this.eventBus.off("show_message", this.showMessage);
			this.eventBus.off("freeze", this.handleFreeze);
			this.eventBus.off("unfreeze", this.handleUnfreeze);
			this.eventBus.off("set_company", this.handleSetCompany);
		}
	},
	methods: {
		initializeNavbar() {
			// Initialize company info from Frappe boot data
			if (frappe.boot && frappe.boot.sysdefaults && frappe.boot.sysdefaults.company) {
				this.company = frappe.boot.sysdefaults.company;
			}

			// Try multiple sources for company logo
			if (frappe.boot && frappe.boot.website_settings && frappe.boot.website_settings.app_logo) {
				this.companyImg = frappe.boot.website_settings.app_logo;
			} else if (
				frappe.boot &&
				frappe.boot.website_settings &&
				frappe.boot.website_settings.banner_image
			) {
				this.companyImg = frappe.boot.website_settings.banner_image;
			}

			// Force reactivity update
			this.$forceUpdate();
		},
		handleNavClick() {
			this.drawer = !this.drawer;
			this.$emit("nav-click");
		},
		goDesk() {
			window.location.href = "/app";
		},
		changePage(page) {
			this.$emit("change-page", page);
		},
		openCloseShift() {
			this.$emit("close-shift");
		},
		printLastInvoice() {
			this.$emit("print-last-invoice");
		},
		async openCashDrawerFromNavbar() {
			try {
				// Prevent multiple simultaneous cash drawer operations
				if (this.cashDrawerOpening) {
					this.showMessage({ title: this.__("Cash drawer is already opening..."), color: "warning" });
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
					this.showMessage({ 
						title: this.__("Opening cash drawer... Counter: {0}", [counter]), 
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
									size: 80mm 80mm;
									margin: 0;
									padding: 0;
								}
								body {
									margin: 0;
									padding: 0;
									width: 80mm;
									height: 80mm;
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
						this.showMessage({ 
							title: this.__("Cash drawer opened successfully! Counter: {0}", [counter]), 
							color: "success" 
						});
					}, 1000);
					
				} else {
					this.showMessage({ title: this.__("Failed to open cash drawer"), color: "error" });
				}
			} catch (error) {
				console.error("Cash drawer error:", error);
				this.showMessage({ title: this.__("Error opening cash drawer"), color: "error" });
			} finally {
				// Reset the flag after a delay to prevent rapid clicking
				setTimeout(() => {
					this.cashDrawerOpening = false;
				}, 2000);
			}
		},
		syncPendingInvoices() {
			this.$emit("sync-invoices");
		},
		toggleManualOffline() {
			this.$emit("toggle-offline");
		},
		async clearCache() {
			if (isOffline()) {
				this.showMessage({
					color: "warning",
					title: this.__("Cannot clear cache while offline"),
				});
				return;
			}
			try {
				await forceClearAllCache();
				await clearAllCaches({ confirmBeforeClear: false }).catch(() => {});
				this.showMessage({
					color: "success",
					title: this.__("Cache cleared successfully"),
				});
			} catch (e) {
				console.error("Failed to clear cache", e);
				this.showMessage({
					color: "error",
					title: this.__("Failed to clear cache"),
				});
			} finally {
				setTimeout(() => location.reload(), 1000);
			}
		},
		toggleTheme() {
			this.$emit("toggle-theme");
		},
		logOut() {
			this.$emit("logout");
		},
		handleShowShortcuts() {
			this.$emit("show-shortcuts");
		},
		handleRecallInvoices() {
			this.$emit("recall-invoices");
		},
		refreshCacheUsage() {
			this.$emit("refresh-cache-usage");
		},
		updateAfterDelete() {
			this.$emit("update-after-delete");
		},
		// Petty Cash Methods
		closePettyCashPayIn() {
			this.showPettyCashPayIn = false;
			this.resetPettyCashForm();
		},
		closePettyCashPayOut() {
			this.showPettyCashPayOut = false;
			this.resetPettyCashForm();
		},
		resetPettyCashForm() {
			this.pettyCashData = {
				amount: "",
				note: "",
				entry_type: "",
				pos_shift: "",
				pos_profile: ""
			};
			this.pettyCashSubmitting = false;
		},
		async submitPettyCashPayIn() {
			if (!this.$refs.pettyCashPayInForm.validate()) return;
			
			this.pettyCashSubmitting = true;
			try {
				await this.createPettyCashEntry("Pay In");
				this.showPettyCashPayIn = false;
				this.showMessage({
					title: __("Pay In recorded successfully"),
					color: "success",
				});
			} catch (error) {
				console.error("Failed to create petty cash entry:", error);
				this.showMessage({
					title: error.message || __("Failed to record Pay In"),
					color: "error",
				});
			} finally {
				this.pettyCashSubmitting = false;
			}
		},
		async submitPettyCashPayOut() {
			if (!this.$refs.pettyCashPayOutForm.validate()) return;
			
			this.pettyCashSubmitting = true;
			try {
				await this.createPettyCashEntry("Pay Out");
				this.showPettyCashPayOut = false;
				this.showMessage({
					title: __("Pay Out recorded successfully"),
					color: "success",
				});
			} catch (error) {
				console.error("Failed to create petty cash entry:", error);
				this.showMessage({
					title: error.message || __("Failed to record Pay Out"),
					color: "error",
				});
			} finally {
				this.pettyCashSubmitting = false;
			}
		},
		async createPettyCashEntry(entryType) {
			// Get current POS opening shift and profile
			const posData = await this.getCurrentPOSData();
			
			// Validate amount
			const amount = parseFloat(this.pettyCashData.amount);
			if (isNaN(amount) || amount <= 0) {
				throw new Error("Amount must be a positive number");
			}
			
			// Validate note
			if (!this.pettyCashData.note || !this.pettyCashData.note.trim()) {
				throw new Error("Note is required");
			}
			
			const entryData = {
				date: frappe.datetime.get_today(),
				entry_type: entryType,
				pos_shift: posData.pos_opening_shift?.name || "",
				pos_profile: posData.pos_profile?.name || "",
				amount: amount,
				note: this.pettyCashData.note.trim(),
				opening_amount: posData.pos_opening_shift?.balance_details?.[0]?.opening_amount || 0,
				closing_amount: posData.pos_opening_shift?.balance_details?.[0]?.closing_amount || 0
			};

			return new Promise((resolve, reject) => {
				frappe.call({
					method: "posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.create_and_submit_petty_cash_entry",
					args: {
						entry_data: entryData
					},
					callback: (r) => {
						if (r.exc) {
							reject(r.exc);
						} else if (r.message && r.message.success) {
							resolve(r.message);
						} else {
							reject(new Error(r.message?.message || "Failed to create petty cash entry"));
						}
					},
					error: (err) => {
						reject(err);
					}
				});
			});
		},
		async getCurrentPOSData() {
			return new Promise((resolve, reject) => {
				frappe.call({
					method: "posawesome.posawesome.api.shifts.check_opening_shift",
					args: {
						user: frappe.session.user
					},
					callback: (r) => {
						if (r.exc) {
							reject(r.exc);
						} else {
							resolve(r.message || {});
						}
					},
					error: (err) => {
						reject(err);
					}
				});
			});
		},
		showMessage(data) {
			this.snackText = data.title;
			this.snackColor = data.color || "success";
			this.snack = true;
		},
		handleFreeze(data) {
			this.freezeTitle = data?.title || "";
			this.freezeMsg = data?.message || "";
			this.freeze = true;
		},
		handleUnfreeze() {
			this.freeze = false;
			this.freezeTitle = "";
			this.freezeMsg = "";
		},
		handleSetCompany(data) {
			if (typeof data === "string") {
				this.company = data;
			} else if (data && data.name) {
				this.company = data.name;
				if (data.company_image) {
					this.companyImg = data.company_image;
				}
			}
		},
		handleMouseLeave() {
			if (!this.drawer) return;
			clearTimeout(this._closeTimeout);
			this._closeTimeout = setTimeout(() => {
				this.drawer = false;
				this.mini = true;
			}, 250);
		},
	},
	emits: [
		"nav-click",
		"change-page",
		"close-shift",
		"print-last-invoice",
		"sync-invoices",
		"toggle-offline",
		"toggle-theme",
		"logout",
		"refresh-cache-usage",
		"update-after-delete",
		"show-shortcuts",
		"recall-invoices",
	],
};
</script>

<style scoped>
/* Main navigation container styles */
nav {
	position: relative;
	z-index: 1000;
}

/* Snackbar positioning */
:deep(.v-snackbar) {
	z-index: 9999;
}

/* Dark theme adjustments */
:deep(.dark-theme) nav,
:deep(.v-theme--dark) nav {
	background-color: var(--background) !important;
}
</style>
