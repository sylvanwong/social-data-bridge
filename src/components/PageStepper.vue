<script setup>
const props = defineProps({
  modelValue: [Number, String],
  label: { type: String, required: true },
  disabled: Boolean,
  roundToInteger: Boolean,
});
const emit = defineEmits(['update:modelValue']);

function commitPages(pages) {
  const value = props.roundToInteger ? Math.round(pages) : pages;
  emit('update:modelValue', Math.max(1, Math.min(50, value)));
}

function step(direction) {
  const pages = Number(props.modelValue) || 0;
  const next = pages >= 1 && pages <= 50 ? pages + direction : pages;
  commitPages(next);
}

function handleFocusOut(event) {
  if (props.roundToInteger && props.modelValue != null && props.modelValue !== '' && !event.currentTarget.contains(event.relatedTarget)) {
    commitPages(Number(props.modelValue));
  }
}
</script>

<template>
  <div class="page-stepper" :class="{ 'is-disabled': disabled }" @focusout="handleFocusOut">
    <input :value="modelValue ?? ''" type="number" min="1" max="50" :aria-label="label" :disabled="disabled" @click.stop
      @input="emit('update:modelValue', $event.target.value === '' ? '' : $event.target.valueAsNumber)" />
    <div class="stepper-buttons" @mousedown.prevent>
      <button type="button" class="stepper-btn stepper-btn-up" :aria-label="'增加' + label" :disabled="disabled || modelValue >= 50"
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
