// Copyright (c) 2024 The Bitcoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <coins.h>
#include <primitives/transaction.h>
#include <script/script.h>
#include <script/sigops.h>

uint32_t CountScriptSigOps(const CScript &script, SigOpCountMode mode) {
    uint32_t nSigOps = 0;
    CScript::const_iterator pc = script.begin();
    opcodetype prevOpcode = OP_INVALIDOPCODE;

    while (pc < script.end()) {
        opcodetype opcode;
        if (!script.GetOp(pc, opcode)) {
            break;
        }

        switch (opcode) {
            case OP_CHECKSIG:
            case OP_CHECKSIGVERIFY:
                nSigOps++;
                break;

            case OP_CHECKDATASIG:
            case OP_CHECKDATASIGVERIFY:
                // Dogecoin: These opcodes don't exist on Dogecoin and therefore
                // don't count as sigops.
                // It's important to not count them as unexecuted sigops still
                // would count and could lead to a fork.
                break;

            case OP_CHECKMULTISIG:
            case OP_CHECKMULTISIGVERIFY:
                if (mode == SigOpCountMode::ACCURATE && prevOpcode >= OP_1 &&
                    prevOpcode <= OP_16) {
                    nSigOps += CScript::DecodeOP_N(prevOpcode);
                } else {
                    nSigOps += MAX_PUBKEYS_PER_MULTISIG;
                }
                break;

            default:
                break;
        }

        prevOpcode = opcode;
    }

    return nSigOps;
}

uint32_t CountScriptSigOpsP2SH(const CScript &scriptSig) {
    // Get the last item that the scriptSig pushes onto the stack:
    CScript::const_iterator pc = scriptSig.begin();
    std::vector<uint8_t> vData;
    while (pc < scriptSig.end()) {
        opcodetype opcode;
        if (!scriptSig.GetOp(pc, opcode, vData)) {
            return 0;
        }
        if (opcode > OP_16) {
            return 0;
        }
    }

    // ... and return its opcount, using "ACCURATE" counting:
    CScript subscript(vData.begin(), vData.end());
    return CountScriptSigOps(subscript, SigOpCountMode::ACCURATE);
}

uint64_t CountTxNonP2SHSigOps(const CTransaction &tx) {
    uint64_t nSigOps = 0;
    for (const CTxIn &txin : tx.vin) {
        nSigOps += CountScriptSigOps(txin.scriptSig, SigOpCountMode::ESTIMATED);
    }
    for (const CTxOut &txout : tx.vout) {
        nSigOps +=
            CountScriptSigOps(txout.scriptPubKey, SigOpCountMode::ESTIMATED);
    }
    return nSigOps;
}

uint64_t CountTxP2SHSigOps(const CTransaction &tx,
                           const CCoinsViewCache &view) {
    if (tx.IsCoinBase()) {
        return 0;
    }

    uint64_t nSigOps = 0;
    for (const CTxIn &txin : tx.vin) {
        const Coin &coin = view.AccessCoin(txin.prevout);
        if (coin.GetTxOut().scriptPubKey.IsPayToScriptHash()) {
            nSigOps += CountScriptSigOpsP2SH(txin.scriptSig);
        }
    }

    return nSigOps;
}

uint64_t CountTxSigOps(const CTransaction &tx, const CCoinsViewCache &view) {
    return CountTxNonP2SHSigOps(tx) + CountTxP2SHSigOps(tx, view);
}
