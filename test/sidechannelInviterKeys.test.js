import test from 'node:test';
import assert from 'node:assert/strict';

import Sidechannel from '../features/sidechannel/index.js';

test('sidechannel: invite-required mode always includes local peer in inviter keys', () => {
  const selfKey = 'A'.repeat(64);
  const remoteKey = 'b'.repeat(64);
  const peer = {
    wallet: {
      publicKey: selfKey,
    },
  };

  const sidechannel = new Sidechannel(peer, {
    inviteRequired: true,
    inviterKeys: [remoteKey],
  });

  assert.ok(sidechannel.inviterKeys instanceof Set);
  assert.equal(sidechannel.inviterKeys.has(selfKey.toLowerCase()), true);
  assert.equal(sidechannel.inviterKeys.has(remoteKey), true);
});
