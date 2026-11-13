/** Custom field definition config (pm.custom_fields.config). Pure types. */

/** Option of a select / multiselect custom field. */
export interface CustomFieldOption {
  readonly id: string;
  readonly label: string;
  readonly color: string;
}

export interface CustomFieldConfig {
  readonly options?: readonly CustomFieldOption[];
  /** ISO 4217 code for currency fields. */
  readonly currency?: string;
  /** Decimal places for number/currency. */
  readonly precision?: number;
  readonly [key: string]: unknown;
}
