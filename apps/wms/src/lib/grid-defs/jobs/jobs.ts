/** Job Management grid (Logiwa 02 §1): 32 columns, 31 filter fields. */
import { OPERATION_TYPES, PRIORITIES } from '@/lib/enums';
import { field, opts, OPEN_WORK_FILTER, type GridSpec } from './shared';

export const JOBS_GRID_KEY = 'jobs';
export const JOB_STATUS_VALUES = ['Pending', 'Started', 'Completed', 'Cancelled'] as const;
export const JOB_PRIORITY_CHOICES = ['None', 'Low', 'Medium', 'High', 'Urgent'] as const;
export const PICKING_ASSIGNMENT_VALUES = ['Assigned', 'Unassigned'] as const;

export const JOB_DEFAULT_FILTER = OPEN_WORK_FILTER('status');

export const JOBS_GRID: GridSpec = {
  gridKey: JOBS_GRID_KEY,
  searchPlaceholder: 'Search by code',
  searchFields: ['code'],
  sortKeys: [
    'warehouse',
    'client',
    'waveNumber',
    'ruleName',
    'code',
    'jobType',
    'status',
    'priority',
    'operationType',
    'assignee',
    'orderCount',
    'productCount',
    'taskCount',
    'pendingTasks',
    'completedTasks',
    'startedAt',
    'completedAt',
    'createdAt',
    'createdBy',
    'pendingPickingTasks',
    'pendingPackingTasks',
    'mobileCart',
    'pickingZone',
    'plannedStartAt',
    'plannedEndAt',
    'locationCount',
    'skuCount',
    'labelStatus',
    'pickListStatus',
    'isResolutionJob',
    'isPrecartonization',
    'overdue',
  ],
  fields: [
    field('completedAt', 'Actual finish date', 'date'),
    field('startedAt', 'Actual start date', 'date'),
    field('aiJob', 'AI job', 'boolean'),
    field('assignee', 'Assignee', 'text'),
    field('client', 'Client', 'text'),
    field('code', 'Code', 'text'),
    field('createdAt', 'Create date', 'date'),
    field('createdBy', 'Created by user', 'text'),
    field('executedBy', 'Executed by user', 'text', {
      description: 'Any task of the job executed by this user',
    }),
    field('status', 'Job status', 'enum', { options: opts(JOB_STATUS_VALUES) }),
    field('jobType', 'Job type', 'text'),
    field('mobileCart', 'Mobile cart', 'text'),
    field('pendingPackingTasks', 'No. of pending packing tasks', 'number'),
    field('pendingPickingTasks', 'No. of pending picking tasks', 'number'),
    field('completedTasks', 'Number of completed tasks', 'number'),
    field('locationCount', 'Number of count locations', 'number'),
    field('skuCount', 'Number of count products', 'number'),
    field('pendingTasks', 'Number of pending tasks', 'number'),
    field('taskCount', 'Number of tasks', 'number'),
    field('operationType', 'Operation type', 'enum', { options: opts(OPERATION_TYPES) }),
    field('orderCount', 'Order count', 'number'),
    field('overdue', 'Overdue', 'boolean', {
      description: 'Pending or started past its planned finish date',
    }),
    field('pickingAssignment', 'Picking assignment status', 'enum', {
      options: opts(PICKING_ASSIGNMENT_VALUES),
    }),
    field('plannedEndAt', 'Planned finish date', 'date'),
    field('plannedStartAt', 'Planned start date', 'date'),
    field('isPrecartonization', 'Pre-cartonization job', 'boolean'),
    field('priority', 'Priority', 'enum', { options: opts(PRIORITIES) }),
    field('productCount', 'Product count', 'number'),
    field('isResolutionJob', 'Resolution job', 'boolean'),
    field('warehouse', 'Warehouse', 'text'),
    field('waveNumber', 'Wave no', 'text'),
    field('ruleName', 'Wave rule name', 'text'),
  ],
};
