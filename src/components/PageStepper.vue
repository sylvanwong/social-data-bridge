<script setup>
import { ref } from 'vue';

const props = defineProps({
  modelValue: [Number, String],
  label: { type: String, required: true },
  disabled: Boolean,
  max: { type: Number, default: 50 },
  roundToInteger: Boolean,
  normalizeValue: Function,
});
const emit = defineEmits(['update:modelValue']);
const isEmptyDraft = ref(false);

function updateValue(value, input) {
  const normalized = props.normalizeValue ? props.normalizeValue(value) : value;
  if (props.normalizeValue && input && normalized !== value) input.value = String(normalized);
  emit('update:modelValue', normalized);
}

function handleInput({ target }) {
  const value = target.value === '' ? '' : target.valueAsNumber;
  isEmptyDraft.value = !!props.normalizeValue && value === '';
  updateValue(value, isEmptyDraft.value ? undefined : target);
}

function handleInputBlur({ target }) {
  if (!isEmptyDraft.value) return;
  isEmptyDraft.value = false;
  updateValue('', target);
}

function commitValue(value) {
  const rounded = props.roundToInteger ? Math.round(value) : value;
  updateValue(Math.max(1, Math.min(props.max, rounded)));
}

function step(direction) {
  isEmptyDraft.value = false;
  const value = Number(props.modelValue) || 0;
  const next = value >= 1 && value <= props.max ? value + direction : value;
  commitValue(next);
}

function handleInputKeydown(event) {
  if (!isEmptyDraft.value || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
  event.preventDefault();
  step(event.key === 'ArrowUp' ? 1 : -1);
}

function handleFocusOut(event) {
  if (props.roundToInteger && props.modelValue != null && props.modelValue !== '' && !event.currentTarget.contains(event.relatedTarget)) {
    commitValue(Number(props.modelValue));
  }
}
</script>

<template>
  <div class="page-stepper" :class="{ 'is-disabled': disabled }" @focusout="handleFocusOut">
    <input :value="isEmptyDraft ? '' : modelValue ?? ''" type="number" min="1" :max="max" :aria-label="label" :disabled="disabled" @click.stop
      @input="handleInput" @blur="handleInputBlur" @keydown="handleInputKeydown" />
    <div class="stepper-buttons" @mousedown.prevent>
      <button type="button" class="stepper-btn stepper-btn-up" :aria-label="'增加' + label" :disabled="disabled || modelValue >= max"
        @click.stop="step(1)"></button>
      <button type="button" class="stepper-btn stepper-btn-down" :aria-label="'减少' + label" :disabled="disabled || modelValue === 1 || modelValue === '' || modelValue == null"
        @click.stop="step(-1)"></button>
    </div>
  </div>
</template>

<style scoped>
.page-stepper {
  display: flex;
  align-items: center;
  width: 80px;
  height: 32px;
  margin-left: var(--app-space-control);
  overflow: hidden;
  border: 1px solid #e5e6eb;
  border-radius: 6px;
  background: #fff;
}
.page-stepper.is-disabled { background: #f2f3f5; }
.page-stepper:focus-within { border-color: #a8071a; }
.page-stepper input {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0 8px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #1d2129;
  font: inherit;
  text-align: center;
  appearance: textfield;
}
.page-stepper input:disabled { color: #86909c; }
.page-stepper input::-webkit-outer-spin-button,
.page-stepper input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}
.stepper-buttons {
  display: flex;
  flex-direction: column;
  width: 28px;
  height: 100%;
  flex-shrink: 0;
  border-left: 1px solid #e5e6eb;
  background: #f2f3f5;
}
.stepper-btn {
  flex: 1;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.stepper-btn-up { border-bottom: 1px solid #e5e6eb; }
.stepper-btn::before {
  display: block;
  width: 0;
  height: 0;
  margin: auto;
  border-right: 4px solid transparent;
  border-left: 4px solid transparent;
  content: '';
}
.stepper-btn-up::before { border-bottom: 4px solid #86909c; }
.stepper-btn-down::before { border-top: 4px solid #86909c; }
.stepper-btn:not(:disabled):hover { background: #fff0f2; }
.stepper-btn:disabled { opacity: .4; cursor: not-allowed; }
</style>
