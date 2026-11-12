/**
 * Raw permission tree — transcribed from references/logiwa-spec/08-settings-shell.md
 * §Users & Roles → Add/Edit Role permission matrix (377 actions).
 *
 * An action is either a label (key = slug of the label) or `[key, label]`.
 * `SUPERVISOR_EXCLUDED` lists the items marked ✗ in Logiwa's Supervisor role.
 * PURE data: safe for client import.
 */

export type ActionSpec = string | readonly [key: string, label: string];

export interface PageSpec {
  readonly key: string;
  readonly label: string;
  readonly actions: readonly ActionSpec[];
}

export interface SectionSpec {
  readonly label: string;
  readonly pages: readonly PageSpec[];
}

export interface GroupSpec {
  readonly key: string;
  readonly label: string;
  readonly sections: readonly SectionSpec[];
}

const page = (key: string, label: string, actions: readonly ActionSpec[]): PageSpec => ({
  key,
  label,
  actions,
});
const viewOnly = (key: string, label: string): PageSpec => page(key, label, ['View']);

const COUNT_DETAIL_ACTIONS: readonly ActionSpec[] = [
  'View',
  'Delete',
  'More Details',
  'Cancel',
  'Create Recount',
  'Update Inv.',
];

export const PERMISSION_TREE: readonly GroupSpec[] = [
  {
    key: 'fulfillment',
    label: 'Fulfillment',
    sections: [
      {
        label: 'Outbound',
        pages: [
          page('shipment_orders', 'Shipment Orders', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Import File',
            'Import Serial Numbers',
            'Import Shipped File',
            'Change Log',
            'Cancel',
            'Ship Order',
            'Create Label',
            'Void Label',
            'Picking/Job Operations',
            'Cancel Picking',
            'Change Warehouse',
            'Tag',
            'Print Picking List',
            'Batch Picking List',
            'Print Packing Slip',
            'Create Back Order',
            'Change Status',
            ['shipment_label_upload', 'Shipment Label Upload (SO Details)'],
            'Reprint Label',
            ['other_documents_upload', 'Other Documents Upload (SO Details)'],
            ['create_new_product', 'Create New Product (SO Details)'],
            'Create RMA',
            'Remove Serial Number',
            'Custom Field Management',
            'Create Retailer Label',
            'Reprint Retailer Label',
            'Download Billing Charges',
            'Pick/Pack Short Label',
            'Pick Short',
            'Pack Short',
            ['override_allocation_cancel_warning', 'Override Order Allocation Cancellation Warning'],
            ['print_manifest_bol', 'Print Manifest / BOL'],
            'Unmerge Order',
            'Create Return Label',
          ]),
          viewOnly('carrier_shipment_details', 'Carrier Shipment Details'),
          page('end_of_day', 'End Of The Day', [
            'View',
            'Print Custom Report',
            'Print End Of The Day Report',
          ]),
          page('packing_station', 'Packing Station', [
            'View',
            'Edit Ship To Address',
            'Print Packing Slip',
            'Report Issue',
          ]),
        ],
      },
      {
        label: 'Task Management',
        pages: [
          page('job_management', 'Job Management', [
            'View',
            'Print Job Pick List',
            'Assign',
            'Cancel',
            'Update Priority',
            'Unassign',
            'Print Job Content',
            'Print Packing List',
            'Print Mobile Cart Layout',
            ['override_job_cancel_warning', 'Override Job Cancellation Warning'],
            'Print Pick Short Consolidation',
          ]),
          page('task_details', 'Task Details', ['View', 'Execute Task', 'Cancel Task', 'Update Task']),
        ],
      },
      {
        label: 'Shipment',
        pages: [
          viewOnly('shipment_history', 'Shipment History'),
          page('shipment_plan', 'Shipment Plan', [
            'View',
            'View Plan Orders',
            'View Plan LPs',
            'Create',
            'Edit',
            'Delete',
            'Ship Order',
            ['picking_operations', 'Picking/Operations'],
            'Change Status',
            ['print_manifest_bol', 'Print Manifest / BOL'],
            'Custom Field Management',
          ]),
        ],
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    sections: [
      {
        label: 'Inbound',
        pages: [
          page('purchase_orders', 'Purchase Orders', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Import File',
            'Import Serial Numbers',
            'Change Log',
            'Cancel Order',
            'Receive PO',
            'Change Status',
            'Download Billing Charges',
            'Custom Field Management',
            'Upload Documents',
            'Tag',
            'Product Label',
            'Purchase Order Label',
            'Remove Serial Number',
            ['create_new_product', 'Create New Product (PO Details)'],
          ]),
          page('receiving_history', 'Receiving History', ['View', 'Cancel']),
          page('return_station', 'Return Station', ['View', 'Receive Return']),
          page('return_orders', 'Return Orders', ['View', 'Change Status', 'Tag']),
          page('work_orders', 'Work Orders', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Create Kit',
            'Disassemble Kit',
            'Tag',
            'Picking/Job Operations',
            'Cancel Picking',
            'Custom Field Management',
            'Import File',
          ]),
        ],
      },
      {
        label: 'Inventory',
        pages: [
          viewOnly('total_inventory', 'Total Inventory'),
          page('inventory_by_location', 'Inventory by Location', [
            'View',
            'Import File',
            'Add Inventory by Line',
            'Adjust Inventory by Line',
            'Remove Inventory by Line',
            'Change Attributes',
            ['transfer_lp_location', 'Transfer LP/Location'],
            'Transfer Product',
            'Add Inventory by Attributes',
            ['transfer_product_convert_uom', 'Transfer Product - Convert to UOM'],
          ]),
          viewOnly('atp', 'ATP'),
        ],
      },
      {
        label: 'Count Operations',
        pages: [
          page('count_plans', 'Count Plans', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Import File',
            'Cancel',
            'Update Inv.',
            'Create Job',
          ]),
          page('count_location_details', 'Count Plan Location Details', COUNT_DETAIL_ACTIONS),
          page('count_sku_details', 'Count Plan SKU Details', COUNT_DETAIL_ACTIONS),
        ],
      },
    ],
  },
  {
    key: 'automation',
    label: 'Automation',
    sections: [
      {
        label: 'Automation',
        pages: [
          page('algorithms', 'Algorithms', ['View', 'Create', 'Edit', 'Delete', 'Change Log', 'Test']),
          page('workflows', 'Workflows', ['View', 'Create', 'Edit', 'Delete', 'Change Log']),
          page('rate_shopping', 'Rate Shopping', ['View', 'Create', 'Edit', 'Delete', 'Change Log']),
          page('wave_rules', 'Wave Rules', ['View', 'Create', 'Edit', 'Delete', 'Change Log', 'Run']),
        ],
      },
    ],
  },
  {
    key: 'integrations',
    label: 'Integrations',
    sections: [
      {
        label: 'Integrations',
        pages: [
          page('integrations', 'Integrations', ['Create Setup', 'Edit Setup', 'Delete Setup']),
          viewOnly('integration_logs', 'Integration Logs'),
          viewOnly('integration_monitoring', 'Integration Monitoring'),
          viewOnly('carrier_monitoring', 'Carrier Monitoring'),
        ],
      },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    sections: [
      {
        label: 'Reports',
        pages: [
          viewOnly('analytics', 'Analytics'),
          viewOnly('shortage_report', 'Shortage Report'),
          viewOnly('channel_sales_report', 'Channel Sales Report'),
          viewOnly('kit_inventory', 'Kit Inventory'),
          viewOnly('dynamic_replenishment_report', 'Dynamic Replenishment Report'),
          viewOnly('inventory_snapshot_report', 'Inventory Snapshot Report'),
          viewOnly('kit_component_availability_report', 'Inventory Kit Component Availability Report'),
          viewOnly('serial_number_tracking_report', 'Serial Number Tracking Report'),
          viewOnly('order_inventory_report', 'Order Inventory Report'),
          viewOnly('excel_export_history', 'Excel Export History'),
          viewOnly('change_log', 'Change Log'),
          viewOnly('transaction_history', 'Transaction History'),
          viewOnly('inventory_missing_log', 'Inventory Missing Log'),
          viewOnly('serial_number_transaction_history', 'Serial Number Transaction History'),
          viewOnly('wave_exceptions', 'Wave Exceptions'),
          viewOnly('wave_log_report', 'Wave Log Report'),
          viewOnly('po_receiving_report', 'PO Receiving Report'),
          viewOnly('user_performance_report', 'User Performance Report'),
        ],
      },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    sections: [
      {
        label: 'Master Data',
        pages: [
          page('retailers', 'Retailers', ['View', 'Create', 'Edit', 'Delete', 'Custom Field Management']),
          page('products', 'Products', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Import File',
            'Change Log',
            'Label',
            'Custom Field Management',
          ]),
          page('product_listing', 'Product Listing', [
            'View',
            'Import File',
            'Search a Product',
            'Tag',
            'Manage Tags',
          ]),
          page('locations', 'Locations', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Import File',
            'Change Log',
            'Custom Field Management',
            'Assign Capacity',
            'Label',
          ]),
          page('vendors', 'Vendors', ['View', 'Create', 'Edit', 'Delete', 'Change Log']),
          page('customers', 'Customers', ['View', 'Create', 'Edit', 'Delete']),
        ],
      },
      {
        label: 'Configuration',
        pages: [
          page('warehouse', 'Warehouse', ['View', 'Create', 'Edit', 'Delete', 'Change Log']),
          page('mobile_carts', 'Mobile Carts', ['View', 'Create', 'Edit', 'Delete', 'Label', 'Duplicate']),
          page('lp_types', 'LP Types', ['View', 'Create', 'Edit', 'Delete', 'Custom Field Management']),
          page('lp_numbers', 'LP Numbers', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Import File',
            'Change Log',
            'Print Barcode',
          ]),
          page('shipment_packages', 'Shipment Packages', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Custom Field Management',
          ]),
          page('printouts_labels', 'Printouts & Labels', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Change Log',
            'Duplicate',
          ]),
          viewOnly('data_setup', 'Data Setup'),
          page('job_types', 'Job Types', ['View', 'Create', 'Edit', 'Delete', 'Change Log']),
          page('screen_configuration', 'Screen Configuration', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Duplicate',
          ]),
          page('barcode_templates', 'Barcode Templates', ['View', 'Create', 'Edit', 'Delete']),
        ],
      },
      {
        label: 'Client Setup',
        pages: [
          page('clients', 'Clients', ['View', 'Create', 'Edit', 'Delete', 'Change Log', 'Import File']),
          page('billing', '3PL Billing', [
            'View',
            'Create',
            'Edit',
            'Delete',
            'Change Log',
            'Calculate',
            'Copy',
          ]),
          page('billing_report', 'Billing Report', ['View', 'Delete', 'Approve', 'Cancel']),
          page('vas_operations', 'VAS Operations', ['View', 'Create', 'Edit', 'Delete', 'Import File']),
        ],
      },
      {
        label: 'Users',
        pages: [
          page('users', 'Users', ['View', 'Create', 'Edit', 'Change Log', 'Import File']),
          page('roles', 'Roles', ['View', 'Create', 'Edit', 'Delete', 'Change Log', 'Manage Restrictions']),
        ],
      },
      {
        label: 'Other Settings',
        pages: [
          viewOnly('change_password', 'Change Password'),
          viewOnly('my_profile', 'My Profile'),
          page('company_settings', 'Company Settings', ['View', 'Update']),
          viewOnly('add_ons', 'Add-Ons'),
        ],
      },
    ],
  },
  {
    key: 'mobile',
    label: 'Mobile',
    sections: [
      {
        label: 'Mobile',
        pages: [
          page('sorting', 'Sorting', [
            ['view', 'View Sorting'],
            'View Sorting Operations',
            'View Sorting Control',
          ]),
          viewOnly('vas_entry', 'VAS Entry'),
          page('picking', 'Picking', [
            ['view', 'View Picking'],
            'View Pick to Location',
            'View Pick and Sort',
            'Pick Your Jobs',
            'Pick Jobs From Pool',
            'Pick Specific Orders',
            'Damaged Action',
            'Missing Action',
            'Skip Action',
            'Alternate License Plate',
            ['inventory_lookup_by_lp_product', 'Inventory Lookup By LP Product'],
          ]),
          page('receiving', 'Receiving', [
            ['view', 'View Receiving'],
            'Damaged Action',
            'Create New Product',
            'Capture Product Photo',
            'Edit Product Physical Attributes',
            [
              'edit_physical_attributes_verification',
              'Edit Product Physical Attributes during Receiving Verification',
            ],
          ]),
          page('transfer', 'Transfer', [
            ['view', 'View Transfer'],
            'View Transfer Product',
            ['view_transfer_lp_tote', 'View Transfer LP/Tote'],
            'View Transfer Location',
            'View Directed Putaway',
            ['view_lp_putaway_directed', 'View LP Put Away in Directed Putaway'],
            ['view_product_putaway_directed', 'View Product Put Away in Directed Put Away'],
            ['uom_bulk_transfer', 'View Convert to UOM option under Bulk Product Transfer'],
            ['uom_one_by_one_transfer', 'View Convert to UOM option under One-by-One Product Transfer'],
            ['uom_bulk_directed_putaway', 'View Convert to UOM option under Bulk Product Directed Putaway'],
            [
              'uom_one_by_one_directed_putaway',
              'View Convert to UOM option under One-by-One Product Directed Putaway',
            ],
            'Sequential LP Putaway',
            'Action Button in Screens',
          ]),
          page('replenishment', 'Replenishment', [
            'View',
            'View Direct Put',
            'View Pick & Put',
            ['replenish_from_assigned_jobs', 'Replenish a Job From the Assigned Jobs'],
            ['replenish_from_job_pool', 'Replenish a Job From the Job Pool'],
            ['replenish_from_scan', 'Replenish a Job From Scan or Enter'],
            'Missing Action',
            'Skip Action',
            'Damaged Action',
            'Cancel Task',
          ]),
          page('loading', 'Loading', [['view', 'View Loading']]),
          page('shipment', 'Shipment', [['view', 'View Ship Location'], 'View Ship With Shipment Plan']),
          page('cycle_count', 'Cycle Count', [
            ['view', 'View Count'],
            'View Your Jobs',
            'View Job Pool',
            'Complete Count & Update Inventory',
            ['skip_location_action', 'Skip Location option in action button in Location Confirmation'],
            ['mark_damage_action', 'Mark as damage option in action button in Product Confirmation'],
            'Reset Location Count',
            'Complete Location Count',
          ]),
          page('instant_count', 'Instant Count', [
            ['view', 'View Instant Count'],
            'Create New Instant Count',
            'Resume Active Instant Count',
            'Reset Location Count',
            'Cancel Location Count',
            'Complete Count & Update Inventory',
            'Cancel Instant Count',
            'Mark as Damaged',
          ]),
          page('look_up', 'Look Up', [['view', 'View Look Up']]),
          page('profile', 'Profile (Mobile)', [
            'Change Password',
            'Change Warehouse',
            'Device Settings',
            'Language',
          ]),
        ],
      },
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    sections: [
      {
        label: 'Analytics',
        pages: [
          viewOnly('labor_analytics', 'Labor Analytics'),
          viewOnly('operational_analytics', 'Operational Analytics'),
        ],
      },
    ],
  },
];

/** Items unchecked (✗) in Logiwa's Supervisor role → excluded from the `manager` default set. */
export const SUPERVISOR_EXCLUDED: readonly string[] = [
  'fulfillment.shipment_orders.create_return_label',
  'fulfillment.job_management.print_packing_list',
  'fulfillment.job_management.print_mobile_cart_layout',
  'settings.shipment_packages.custom_field_management',
  'settings.barcode_templates.view',
  'settings.barcode_templates.create',
  'settings.barcode_templates.edit',
  'settings.barcode_templates.delete',
  'mobile.picking.alternate_license_plate',
  'mobile.picking.inventory_lookup_by_lp_product',
];
