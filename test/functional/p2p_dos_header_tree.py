# Copyright (c) 2019 The Bitcoin Core developers
# Distributed under the MIT software license, see the accompanying
# file COPYING or http://www.opensource.org/licenses/mit-license.php.
"""Test that we reject low difficulty headers to prevent our block tree from filling up with useless bloat"""

import os

from test_framework.messages import CBlockHeader, FromHex
from test_framework.p2p import P2PInterface, msg_headers
from test_framework.test_framework import BitcoinTestFramework, SkipTest


class RejectLowDifficultyHeadersTest(BitcoinTestFramework):
    def set_test_params(self):
        self.setup_clean_chain = True
        self.chain = "testnet3"  # Use testnet chain because it has an early checkpoint
        self.num_nodes = 2
        self.extra_args = [["-minimumchainwork=0x0"], ["-minimumchainwork=0x0"]]

    def add_options(self, parser):
        parser.add_argument(
            "--datafile",
            default="data/blockheader_testnet3.hex",
            help="Test data file (default: %(default)s)",
        )

    def run_test(self):
        # Temporarily skip the test to keep test suite green. Need to collect testnet headers before we can fix this.
        raise SkipTest("Need Doge testnet headers")

        self.log.info("Read headers data")
        self.headers_file_path = os.path.join(
            os.path.dirname(os.path.realpath(__file__)), self.options.datafile
        )
        with open(self.headers_file_path, encoding="utf-8") as headers_data:
            h_lines = [line.strip() for line in headers_data.readlines()]

        # The headers data is taken from testnet3 for early blocks from genesis until the first checkpoint. There are
        # two headers with valid POW at height 1 and 2, forking off from
        # genesis. They are indicated by the FORK_PREFIX.
        FORK_PREFIX = "fork:"
        self.headers = [line for line in h_lines if not line.startswith(FORK_PREFIX)]
        self.headers_fork = [
            line[len(FORK_PREFIX) :] for line in h_lines if line.startswith(FORK_PREFIX)
        ]

        self.headers = [FromHex(CBlockHeader(), h) for h in self.headers]
        self.headers_fork = [FromHex(CBlockHeader(), h) for h in self.headers_fork]

        self.log.info(
            "Feed all non-fork headers, including and up to the first checkpoint"
        )
        peer_checkpoint = self.nodes[0].add_p2p_connection(P2PInterface())
        peer_checkpoint.send_and_ping(msg_headers(self.headers))
        assert {
            "height": 546,
            "hash": "ac537cfeda975e45040e9938d08e40a16e0fbd6388d02d9b4928b8ae0108c626",
            "branchlen": 546,
            "status": "headers-only",
        } in self.nodes[0].getchaintips()

        self.log.info("Feed all fork headers (fails due to checkpoint)")
        with self.nodes[0].assert_debug_log(["bad-fork-prior-to-checkpoint"]):
            peer_checkpoint.send_message(msg_headers(self.headers_fork))
            peer_checkpoint.wait_for_disconnect()

        self.log.info("Feed all fork headers (succeeds without checkpoint)")
        # On node 0 it succeeds because checkpoints are disabled
        self.restart_node(0, ["-nocheckpoints", "-minimumchainwork=0x0"])
        peer_no_checkpoint = self.nodes[0].add_p2p_connection(P2PInterface())
        peer_no_checkpoint.send_and_ping(msg_headers(self.headers_fork))
        assert {
            "height": 2,
            "hash": "fec29ddbe561550d58abeb950f55c74f69c0885342651b2ee889091acc77a5e3",
            "branchlen": 2,
            "status": "headers-only",
        } in self.nodes[0].getchaintips()

        # On node 1 it succeeds because no checkpoint has been reached yet by a
        # chain tip
        peer_before_checkpoint = self.nodes[1].add_p2p_connection(P2PInterface())
        peer_before_checkpoint.send_and_ping(msg_headers(self.headers_fork))
        assert {
            "height": 2,
            "hash": "fec29ddbe561550d58abeb950f55c74f69c0885342651b2ee889091acc77a5e3",
            "branchlen": 2,
            "status": "headers-only",
        } in self.nodes[1].getchaintips()


if __name__ == "__main__":
    RejectLowDifficultyHeadersTest().main()
