import { printSeparator } from "../utils/print";
import { buildOnchainMetadata } from "../utils/jetton-helpers";
import * as dotenv from "dotenv";

dotenv.config();
// ========================================
import { configJettonParams } from "./contract.config";
import { _ENDPOINT_MAINNET, _ENDPOINT_TESTNET } from "../utils/static";
import { Address } from "@ton/core";
import { beginCell, contractAddress, fromNano, internal, toNano, TonClient4, WalletContractV4 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { JettonMasterContract, storeTokenTransfer } from "../../artifact/jetton/JettonTact_JettonMasterContract";

// ========================================

export async function transferJetton(from: string, to: string) {
    const client4 = new TonClient4({
        endpoint: process.env._IS_TEST_ENV === "true" ? _ENDPOINT_TESTNET : _ENDPOINT_MAINNET,
    });

    console.info(" ###### Using ", process.env._IS_TEST_ENV === "true" ? "Testnet" : "Mainnet");
    let workchain = 0;

    // 🔴 Change to your own, by creating .env file!
    let ownerMnemonics = (process.env.MNEMONICS_OWNER || "").toString();
    let ownerKeyPair = await mnemonicToPrivateKey(ownerMnemonics.split(" "));
    let ownerSecretKey = ownerKeyPair.secretKey;
    let ownerTonWallet = WalletContractV4.create({
        workchain,
        publicKey: ownerKeyPair.publicKey,
    });

    let ownerTonWalletContract = client4.open(ownerTonWallet);

    // Create content Cell
    let content = buildOnchainMetadata(configJettonParams);
    let maxSupply = toNano(123456766689011); // 🔴 Set the specific total supply in nano

    // Compute init data for deployment
    // NOTICE: the parameters inside the init functions were the input for the contract address
    // which means any changes will change the smart contract address as well.
    let owner = ownerTonWalletContract.address;
    let init = await JettonMasterContract.init(owner, content, maxSupply);
    console.log("✨ Jetton Owner address: " + owner + "");

    let jettonMasterWallet = contractAddress(workchain, init);
    let jettonMasterContract = JettonMasterContract.fromAddress(jettonMasterWallet);
    let jettonMasterContractOpened = client4.open(jettonMasterContract);
    let ownerJettonWallet = await jettonMasterContractOpened.getGetWalletAddress(owner);

    // ✨Pack the forward message into SAME cell
    // 🔴 whether you want to store the forward payload in the same cell or not. 0 means no, 1 means yes.
    // https://docs.ton.org/develop/func/cookbook#how-to-contain-a-body-as-slice-to-an-internal-message-cell
    // 🔴 whether you want to store the forward payload in the same cell or not. 0 means no, 1 means yes.

    const forwardPayloadLeft = beginCell()
        .storeBit(0) // 🔴 whether you want to store the forward payload in the same cell or not. 0 means no, 1 means yes.
        .storeUint(0, 32)
        .storeUint(0, 32)
        .storeBuffer(Buffer.from("transfer jetton", "utf-8"))
        .storeBuffer(Buffer.from(".", "utf-8"))
        .endCell();
    // https://docs.ton.org/develop/func/cookbook#how-to-contain-a-body-as-ref-to-an-internal-message-cell
    // const forward_message_right = beginCell()
    //     .storeBit(1) // 🔴 whether you want to store the forward payload in the same cell or not. 0 means no, 1 means yes.
    //     .storeRef(beginCell().storeUint(0, 32).storeBuffer(Buffer.from("[Right Side] body as ref to internal msg. ", "utf-8")).endCell())
    //     .endCell();

    // ========================================

    // 🔴 Change to your own, by creating .env file!
    let senderMnemonics = (from || "").toString();
    let senderKeyPair = await mnemonicToPrivateKey(senderMnemonics.split(" "));
    let senderSecretKey = senderKeyPair.secretKey;
    let senderTonWallet = WalletContractV4.create({
        workchain,
        publicKey: senderKeyPair.publicKey,
    });

    let senderTonWalletContract = client4.open(senderTonWallet);
    let senderJettonWallet = await jettonMasterContractOpened.getGetWalletAddress(senderTonWallet.address);
    let deployAmount = toNano("2");
    let seqno: number = await senderTonWalletContract.getSeqno();
    let balance: bigint = await senderTonWalletContract.getBalance();
    // ========================================

    // ----------- pack
    let receiverTonWalletAddress = Address.parse(to as string);
    let customPayload = beginCell().storeBit(1).storeUint(0, 32).storeStringTail("EEEEEE").endCell();
    let packed = beginCell()
        .store(
            storeTokenTransfer({
                $$type: "TokenTransfer",
                query_id: 0n,
                amount: toNano(50),
                destination: receiverTonWalletAddress,
                response_destination: senderTonWallet.address, // cashback to sender
                custom_payload: customPayload,
                forward_ton_amount: toNano("0.01"),
                forward_payload: forwardPayloadLeft,
            }),
        )
        .endCell();

    // =========== pack

    printSeparator();
    console.log("Current deployment senderTonWallet balance: ", fromNano(balance).toString(), "💎TON");
    console.log("\n🛠️ Calling Sender's JettonWallet:\n" + senderJettonWallet + "\n");
    await senderTonWalletContract.sendTransfer({
        seqno,
        secretKey: senderSecretKey,
        messages: [
            internal({
                to: senderJettonWallet,
                value: deployAmount,
                init: {
                    code: init.code,
                    data: init.data,
                },
                bounce: true,
                body: packed,
            }),
        ],
    });
}

(async () => {
    await transferJetton(process.env.MNEMONICS_OWNER as string, process.env.TON_WALLET_ADDRESS_ALISON as string);
})();
