# Copyright (c) 2024 The Bitcoin developers
# Distributed under the MIT software license, see the accompanying
# file COPYING or http://www.opensource.org/licenses/mit-license.php.
"""Test the resolution of stake contender preconsensus via avalanche."""
import time

from test_framework.avatools import can_find_inv_in_poll, get_ava_p2p_interface
from test_framework.key import ECPubKey
from test_framework.messages import (
    MSG_AVA_STAKE_CONTENDER,
    AvalancheContenderVoteError,
    AvalancheVote,
    hash256,
    ser_uint256,
)
from test_framework.test_framework import BitcoinTestFramework
from test_framework.util import assert_equal, uint256_hex

QUORUM_NODE_COUNT = 16


class AvalancheContenderVotingTest(BitcoinTestFramework):
    def set_test_params(self):
        self.setup_clean_chain = True
        self.num_nodes = 1
        self.extra_args = [
            [
                "-avalanche",
                "-avalanchestakingpreconsensus=1",
                "-avalanchestakingrewards=1",
                "-avaproofstakeutxodustthreshold=1000000",
                "-avaproofstakeutxoconfirmations=1",
                "-avacooldown=0",
                "-avaminquorumstake=0",
                "-avaminavaproofsnodecount=0",
                "-whitelist=noban@127.0.0.1",
                "-persistavapeers=0",
            ],
        ]
        self.supports_cli = False

    def run_test(self):
        node = self.nodes[0]

        # Set mock time so we can control when proofs will be considered for staking rewards
        now = int(time.time())
        node.setmocktime(now)

        # Build a fake quorum of nodes.
        def get_quorum():
            def new_ava_interface(node):
                # This test depends on each proof being added to the contender cache before
                # the next block arrives, so we wait until that happens.
                peer = get_ava_p2p_interface(self, node)
                blockhash = node.getbestblockhash()
                self.wait_until(
                    lambda: node.getstakecontendervote(
                        blockhash, uint256_hex(peer.proof.proofid)
                    )
                    == AvalancheContenderVoteError.PENDING
                )
                return peer

            return [new_ava_interface(node) for _ in range(0, QUORUM_NODE_COUNT)]

        # Pick one node from the quorum for polling.
        quorum = get_quorum()
        poll_node = quorum[0]

        assert node.getavalancheinfo()["ready_to_poll"] is True

        def has_finalized_proof(proofid):
            can_find_inv_in_poll(quorum, proofid)
            return node.getrawavalancheproof(uint256_hex(proofid))["finalized"]

        for peer in quorum:
            self.wait_until(lambda: has_finalized_proof(peer.proof.proofid))

        # Get the key so we can verify signatures.
        avakey = ECPubKey()
        avakey.set(bytes.fromhex(node.getavalanchekey()))

        def assert_response(expected):
            response = poll_node.wait_for_avaresponse()
            r = response.response

            # Verify signature
            assert avakey.verify_schnorr(response.sig, r.get_hash())

            votes = r.votes
            assert_equal(len(votes), len(expected))
            for i in range(0, len(votes)):
                assert_equal(repr(votes[i]), repr(expected[i]))

        def make_contender_id(prevblockhash, proofid):
            return int.from_bytes(
                hash256(ser_uint256(int(prevblockhash, 16)) + ser_uint256(proofid)),
                "little",
            )

        # Before finalizing any blocks, no contender promotion occurs in the cache,
        # so the only way to test if the node knows about a particular contender is
        # to check it at the block height that the proof was first seen at.
        for i in range(0, QUORUM_NODE_COUNT):
            # We started with a clean chain and a new block is mined when creating
            # each quorum proof to make it valid, so the first block the proof was
            # seen at is the quorum proof's index + 1.
            blockhash = node.getblockhash(i + 1)
            poll_ids = []
            expected = []
            for p in range(0, QUORUM_NODE_COUNT):
                contender_proof = quorum[p].proof
                contender_id = make_contender_id(blockhash, contender_proof.proofid)
                poll_ids.append(contender_id)
                # If the node knows about the contender, it will respond as INVALID
                expected_vote = (
                    AvalancheContenderVoteError.PENDING
                    if p == i
                    else AvalancheContenderVoteError.UNKNOWN
                )
                expected.append(AvalancheVote(expected_vote, contender_id))
            poll_node.send_poll(poll_ids, inv_type=MSG_AVA_STAKE_CONTENDER)
            assert_response(expected)

        # Unknown contender
        unknown_contender_id = 0x123
        poll_node.send_poll([unknown_contender_id], inv_type=MSG_AVA_STAKE_CONTENDER)
        assert_response(
            [AvalancheVote(AvalancheContenderVoteError.UNKNOWN, unknown_contender_id)]
        )

        def has_finalized_tip(tip_expected):
            hash_tip_final = int(tip_expected, 16)
            can_find_inv_in_poll(quorum, hash_tip_final)
            return node.isfinalblock(tip_expected)

        # Finalize a block so we promote the contender cache with every block
        tip = node.getbestblockhash()
        self.wait_until(lambda: has_finalized_tip(tip))
        assert_equal(node.getbestblockhash(), tip)

        # Now trigger building the whole cache for a block
        tip = self.generate(node, 1)[0]

        # Unknown contender is still unknown
        poll_node.send_poll([unknown_contender_id], inv_type=MSG_AVA_STAKE_CONTENDER)
        assert_response(
            [AvalancheVote(AvalancheContenderVoteError.UNKNOWN, unknown_contender_id)]
        )

        # Pick a proof and poll for its status (not a winner since mock time has not
        # advanced past the staking rewards minimum registration delay)
        manual_winner = quorum[1].proof
        contender_id = make_contender_id(tip, manual_winner.proofid)
        poll_node.send_poll([contender_id], inv_type=MSG_AVA_STAKE_CONTENDER)
        assert_response(
            [AvalancheVote(AvalancheContenderVoteError.PENDING, contender_id)]
        )

        # Advance time past the staking rewards minimum registration delay and
        # mine a block.
        now += 90 * 60 + 1
        node.setmocktime(now)
        tip = self.generate(node, 1)[0]

        # Staking rewards has been computed
        contender_id = make_contender_id(tip, manual_winner.proofid)
        poll_node.send_poll([contender_id], inv_type=MSG_AVA_STAKE_CONTENDER)
        expectedVote = AvalancheContenderVoteError.INVALID
        if node.getstakingreward(tip)[0]["proofid"] == uint256_hex(
            manual_winner.proofid
        ):
            # If manual_winner happens to be selected as the winner, it will be accepted
            expectedVote = AvalancheContenderVoteError.ACCEPTED
        assert_response([AvalancheVote(expectedVote, contender_id)])

        # Manually set this contender as a winner
        node.setstakingreward(tip, manual_winner.payout_script.hex())
        poll_node.send_poll([contender_id], inv_type=MSG_AVA_STAKE_CONTENDER)
        assert_response(
            [AvalancheVote(AvalancheContenderVoteError.ACCEPTED, contender_id)]
        )


if __name__ == "__main__":
    AvalancheContenderVotingTest().main()
