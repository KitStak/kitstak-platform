/** Ready-made question sets for new intake forms (client-safe). */
import type { FormField, FormFieldType, FormSettings } from '@/lib/form-types';

export function newFieldId(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`;
}

export const FIELD_TYPE_LABELS: Readonly<Record<FormFieldType, string>> = {
  short_text: 'Short answer',
  long_text: 'Paragraph',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  date: 'Date',
  select: 'Pick one',
  multiselect: 'Pick several',
  checkbox: 'Yes / no',
  url: 'Link',
};

export function blankField(type: FormFieldType): FormField {
  const choices = type === 'select' || type === 'multiselect';
  return {
    id: newFieldId(),
    label: '',
    type,
    required: false,
    options: choices
      ? [
          { id: newFieldId(), label: 'Option 1' },
          { id: newFieldId(), label: 'Option 2' },
        ]
      : undefined,
    mapTo: null,
  };
}

const opt = (label: string) => ({ id: newFieldId(), label });

export interface FormStarter {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly formName: string;
  readonly description: string;
  readonly fields: () => FormField[];
  readonly settings?: FormSettings;
}

export const FORM_STARTERS: readonly FormStarter[] = [
  {
    id: 'request',
    name: 'General request',
    blurb: 'What, why and by when. Works for almost anything.',
    formName: 'Request form',
    description: 'Tell us what you need and we’ll get it on the list. You’ll hear back within one working day.',
    fields: () => [
      { id: newFieldId(), label: 'What do you need?', type: 'short_text', required: true, placeholder: 'For example: new pallet labels for dock 2', mapTo: 'title' },
      { id: newFieldId(), label: 'Tell us more', type: 'long_text', required: false, helpText: 'Any details that help us get it right the first time.', mapTo: 'description' },
      { id: newFieldId(), label: 'When do you need it by?', type: 'date', required: false, mapTo: 'due_date' },
      { id: newFieldId(), label: 'How urgent is it?', type: 'select', required: false, options: [opt('Urgent'), opt('High'), opt('Medium'), opt('Low')], mapTo: 'priority' },
    ],
  },
  {
    id: 'bug',
    name: 'Problem report',
    blurb: 'Something broke? Collect what, where and how bad.',
    formName: 'Report a problem',
    description: 'Something not working? Tell us what happened and we’ll fix it.',
    fields: () => [
      { id: newFieldId(), label: 'What went wrong?', type: 'short_text', required: true, placeholder: 'One line about the problem', mapTo: 'title' },
      { id: newFieldId(), label: 'What happened, step by step?', type: 'long_text', required: true, mapTo: 'description' },
      { id: newFieldId(), label: 'Where did it happen?', type: 'select', required: false, options: [opt('Website'), opt('Mobile app'), opt('Warehouse floor'), opt('Somewhere else')], mapTo: null },
      { id: newFieldId(), label: 'How bad is it?', type: 'select', required: true, options: [opt('Urgent'), opt('High'), opt('Medium'), opt('Low')], mapTo: 'priority' },
      { id: newFieldId(), label: 'Link to a screenshot or page', type: 'url', required: false, mapTo: null },
    ],
    settings: { priority: 'high' },
  },
  {
    id: 'client',
    name: 'Client request',
    blurb: 'For customers: company, order number and what they need.',
    formName: 'Client request',
    description: 'Need something from our team? Send it here and we’ll take it from there.',
    fields: () => [
      { id: newFieldId(), label: 'Company name', type: 'short_text', required: true, mapTo: null },
      { id: newFieldId(), label: 'What can we help with?', type: 'short_text', required: true, mapTo: 'title' },
      { id: newFieldId(), label: 'Order or reference number', type: 'short_text', required: false, helpText: 'If it’s about a shipment or order.', mapTo: null },
      { id: newFieldId(), label: 'Details', type: 'long_text', required: false, mapTo: 'description' },
      { id: newFieldId(), label: 'Needed by', type: 'date', required: false, mapTo: 'due_date' },
    ],
    settings: { collectContact: true, confirmationMessage: 'Thanks! Our team has your request and will reply by email.' },
  },
  {
    id: 'event',
    name: 'Event sign-up',
    blurb: 'Names, teams and dietary needs for a team event.',
    formName: 'Event sign-up',
    description: 'Save your spot. We’ll send the details a week before.',
    fields: () => [
      { id: newFieldId(), label: 'Your full name', type: 'short_text', required: true, mapTo: 'title' },
      { id: newFieldId(), label: 'Team', type: 'select', required: true, options: [opt('Operations'), opt('Sales'), opt('Marketing'), opt('Engineering'), opt('Other')], mapTo: null },
      { id: newFieldId(), label: 'Food needs or allergies', type: 'long_text', required: false, mapTo: null },
      { id: newFieldId(), label: 'I’m bringing a guest', type: 'checkbox', required: false, mapTo: null },
    ],
    settings: { confirmationMessage: 'You’re signed up! See you there.' },
  },
  {
    id: 'blank',
    name: 'Start from scratch',
    blurb: 'One question to begin. Add your own.',
    formName: 'New form',
    description: '',
    fields: () => [{ id: newFieldId(), label: 'What do you need?', type: 'short_text', required: true, mapTo: 'title' }],
  },
];
