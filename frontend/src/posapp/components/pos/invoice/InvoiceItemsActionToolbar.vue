<template>
	<div class="column-selector-container">
		<v-text-field
			ref="itemSearchField"
			:model-value="itemSearch"
			@update:model-value="$emit('update:itemSearch', $event)"
			density="compact"
			variant="solo"
			color="primary"
			class="item-search-field pos-themed-input"
			:label="__('Search items or barcode')"
			prepend-inner-icon="mdi-magnify"
			hide-details
			clearable
			autocomplete="off"
		></v-text-field>
	</div>
</template>

<script setup>
import { ref } from "vue";

defineProps({
	itemSearch: {
		type: String,
		default: "",
	},
});

defineEmits(["update:itemSearch"]);

const itemSearchField = ref(null);

const focusSearch = () => {
	itemSearchField.value?.focus?.();
};

defineExpose({
	focusSearch,
});
</script>
