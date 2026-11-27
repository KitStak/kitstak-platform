/**
 * Pulse and @kitstak/pulse-bridge must agree on who a person is in Pulse and on the five
 * status words, because sibling apps show Pulse numbers through the bridge. This walks every
 * combination of inputs through both resolvers and fails on the first difference.
 */
import { describe, expect, it } from 'vitest';
import { PULSE_STATUS_LABELS as BRIDGE_LABELS, PULSE_ROLES as BRIDGE_ROLES } from '../../../../../packages/pulse-bridge/src/types';
import { parseOrgRole as bridgeParseOrgRole, pulseRoleFromWmsUser as bridgeWmsRole, resolveAccess as bridgeResolve } from '../../../../../packages/pulse-bridge/src/access';
import { PULSE_STATUS_LABELS } from '@/lib/constants';
import { ORG_ROLES, PULSE_ROLES, canPulse, parseOrgRole, type OrgRole, type PulseRole } from '@/lib/permissions';
import { pulseRoleFromWmsUser, resolveAccess } from '@/server/domain/access';

describe('bridge parity', () => {
  it('uses the same roles and the same five status words', () => {
    expect([...BRIDGE_ROLES]).toEqual([...PULSE_ROLES]);
    expect(BRIDGE_LABELS).toEqual(PULSE_STATUS_LABELS);
  });

  it('resolves the same role and the same money rights for every combination', () => {
    const explicitRoles: (string | null)[] = [null, ...PULSE_ROLES, 'not-a-role'];
    const wmsRoles: (PulseRole | null)[] = [null, ...PULSE_ROLES];
    const orgRoles: (OrgRole | null)[] = [null, ...ORG_ROLES];
    let checked = 0;
    for (const explicitRole of explicitRoles) {
      for (const seesMoney of [false, true]) {
        for (const wmsRole of wmsRoles) {
          for (const orgRole of orgRoles) {
            for (const defaultMemberRole of PULSE_ROLES) {
              const input = { explicit: explicitRole === null ? null : { role: explicitRole, seesMoney }, wmsRole, orgRole, defaultMemberRole };
              const ours = resolveAccess(input);
              const theirs = bridgeResolve(input);
              expect({ role: theirs.role, source: theirs.source, seesMoney: theirs.seesMoney, seesWages: theirs.seesWages }).toEqual({
                role: ours.role,
                source: ours.source,
                seesMoney: ours.seesMoney,
                seesWages: ours.seesWages,
              });
              expect(theirs.canLog).toBe(canPulse(ours.role, 'production:log'));
              expect(theirs.canManageJobs).toBe(canPulse(ours.role, 'job:manage'));
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('reads warehouse users and org role lists the same way', () => {
    for (const userType of [null, 'Owner', 'Operation', 'Client', 'owner']) {
      for (const role of [null, 'Admin', 'Manager', 'Operator', 'Viewer', 'other']) {
        for (const isApiUser of [false, true]) {
          expect(bridgeWmsRole({ userType, role, isApiUser })).toBe(pulseRoleFromWmsUser({ userType, role, isApiUser }));
        }
      }
    }
    for (const raw of [null, '', 'owner', 'member,admin', 'deactivated:member', 'guest', 'viewer,member', 'nonsense']) {
      expect(bridgeParseOrgRole(raw)).toBe(parseOrgRole(raw));
    }
  });
});
