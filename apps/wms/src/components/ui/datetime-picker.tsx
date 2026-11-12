'use client';

import * as React from 'react';
import { DateField, type DateFieldBaseProps } from './date-picker';

/** Date + time in the picker format `YYYY/MM/DD HH:mm` (BUILD_PLAN 0.1). */
export function DateTimePicker(props: DateFieldBaseProps) {
  return <DateField {...props} includeTime />;
}
