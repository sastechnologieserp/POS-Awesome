<template>
	<v-row align="center" justify="space-between" class="items px-3 py-2 mt-0" v-if="showPostingDate || showCustomerBalance">
		<v-col v-if="showPostingDate" cols="12" :sm="showCustomerBalance ? 4 : 12" class="pb-2">
			<VueDatePicker
				v-model="internal_posting_date_display"
				model-type="format"
				format="dd-MM-yyyy"
				auto-apply
				:placeholder="frappe._('Posting Date')"
				:dark="isDarkTheme"
				class="dark-field sleek-field posting-date-input"
				@update:model-value="onUpdate"
			/>
		</v-col>
		<v-col
			v-if="showCustomerBalance"
			cols="12"
			:sm="showPostingDate ? 8 : 12"
			class="pb-2 d-flex align-center justify-sm-end"
		>
			<div class="balance-field">
				<strong>{{ __("Customer Balance") }}:</strong>
				<span class="balance-value">{{ formatCurrency(customer_balance) }}</span>
			</div>
		</v-col>
	</v-row>
</template>

<script>
export default {
	props: {
		pos_profile: Object,
		posting_date_display: String,
		customer_balance: Number,
		formatCurrency: Function,
	},
	data() {
		return {
			internal_posting_date_display: this.posting_date_display,
		};
	},
	computed: {
		isDarkTheme() {
			return this.$theme?.current === "dark";
		},
		showPostingDate() {
			return !!this.pos_profile?.posa_allow_change_posting_date;
		},
		showCustomerBalance() {
			return !!this.pos_profile?.posa_show_customer_balance;
		},
	},
	watch: {
		posting_date_display(val) {
			this.internal_posting_date_display = val;
		},
	},
	methods: {
		onUpdate(val) {
			this.$emit("update:posting_date_display", val);
		},
	},
};
</script>

<style scoped>
/* Dark mode styling for input wrapper */
:deep(.dark-theme) .dark-field,
:deep(.v-theme--dark) .dark-field,
::v-deep(.dark-theme) .dark-field,
::v-deep(.v-theme--dark) .dark-field {
	background-color: #1e1e1e !important;
}

/* Ensure input text and label are readable */
:deep(.dark-theme) .dark-field :deep(.v-field__input),
:deep(.v-theme--dark) .dark-field :deep(.v-field__input),
:deep(.dark-theme) .dark-field :deep(input),
:deep(.v-theme--dark) .dark-field :deep(input),
:deep(.dark-theme) .dark-field :deep(.v-label),
:deep(.v-theme--dark) .dark-field :deep(.v-label),
::v-deep(.dark-theme) .dark-field .v-field__input,
::v-deep(.v-theme--dark) .dark-field .v-field__input,
::v-deep(.dark-theme) .dark-field input,
::v-deep(.v-theme--dark) .dark-field input,
::v-deep(.dark-theme) .dark-field .v-label,
::v-deep(.v-theme--dark) .dark-field .v-label {
	color: #fff !important;
}

/* Overlay background in dark mode */
:deep(.dark-theme) .dark-field :deep(.v-field__overlay),
:deep(.v-theme--dark) .dark-field :deep(.v-field__overlay),
::v-deep(.dark-theme) .dark-field .v-field__overlay,
::v-deep(.v-theme--dark) .dark-field .v-field__overlay {
	background-color: #1e1e1e !important;
}

/* Dark mode styling for date picker input */
:deep(.dark-theme) .dp__input,
:deep(.v-theme--dark) .dp__input,
::v-deep(.dark-theme) .dp__input,
::v-deep(.v-theme--dark) .dp__input {
	background-color: #1e1e1e !important;
	color: #fff !important;
}

/* Dark mode styling for date picker calendar dropdown */
:deep(.dark-theme) .dp__menu,
:deep(.v-theme--dark) .dp__menu,
::v-deep(.dark-theme) .dp__menu,
::v-deep(.v-theme--dark) .dp__menu {
	background-color: #1e1e1e !important;
	color: #fff !important;
}

/* Sleek design for VueDatePicker */
:deep(.sleek-field) .dp__input_wrap {
	width: 100%;
	box-sizing: border-box;
}

:deep(.sleek-field) .dp__input {
	width: 100%;
	border-radius: 12px;
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
	transition: box-shadow 0.3s ease;
	background-color: var(--field-bg);
	color: var(--text-primary);
	padding: 10px 12px;
}

:deep(.sleek-field:hover) .dp__input {
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

/* Align calendar icon to the right, before the clear icon */
.posting-date-input :deep(.dp__input_icon) {
	inset-inline-start: auto;
	inset-inline-end: 30px;
}

/* Remove extra left padding added for left icon placement */
.posting-date-input :deep(.dp__input_icon_pad) {
	padding-inline-start: 12px;
}

/* Increase right padding to accommodate both icons */
.posting-date-input :deep(.dp__input) {
	padding-right: calc(30px + var(--dp-input-icon-padding));
}
</style>
