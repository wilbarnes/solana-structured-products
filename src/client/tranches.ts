import {
    Account,
    Connection,
    BpfLoader,
    BPF_LOADER_PROGRAM_ID,
    PublicKey,
    LAMPORTS_PER_SOL,
    SystemProgram,
    TransactionInstruction,
    SYSVAR_RENT_PUBKEY,
    Transaction,
    // sendAndConfirmTransaction,
} from '@solana/web3.js';

import * as Layout from './layout';

import fs from 'mz/fs';

import {sendAndConfirmTransaction} from './utils/send-and-confirm-transactions';
import {newAccountWithLamports} from './utils/new-account-with-lamports';
import {Store} from "./utils/store";

// @ts-ignore
import BufferLayout from 'buffer-layout';

let accountUsdc: Account;
let accountSol: Account;

// hacky solution for seed b/c i can't get toBuffer() to work elsewhere
let seed1: PublicKey = new Account().publicKey;
let seed2: PublicKey = new Account().publicKey;

// structured product account
let programId: Account;

let payerAccount: Account;
let connection: Connection;
let rentExemption: number;
let token: Account;

let mintAccount1: Account;
let mintAccount2: Account;

let freezeAccount: Account;

const pathToProgram = '../tranched-liquidity/target/bpfel-unknown-unknown/release/tranched_liquidity.so'

const TOKEN_PROGRAM_ID: PublicKey = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

export async function establishConnection(): Promise<void> {
    connection = new Connection('http://devnet.solana.com', 'singleGossip');
    const version = await connection.getVersion();
    console.log('Connection to cluster established:', 'http://devnet.solana.com', version);
}

export async function establishPayer(): Promise<void> {
    if (!payerAccount) {
        let fees = 0;
        const {feeCalculator} = await connection.getRecentBlockhash();

        // calculate the cost to load the program
        const data = await fs.readFile(pathToProgram);
        const NUM_RETRIES = 500;
        fees +=
            feeCalculator.lamportsPerSignature *
                (BpfLoader.getMinNumSignatures(data.length) + NUM_RETRIES) +
            (await connection.getMinimumBalanceForRentExemption(data.length));

        fees += feeCalculator.lamportsPerSignature * 100;

        payerAccount = await newAccountWithLamports(connection, fees);
        accountUsdc = await newAccountWithLamports(connection, fees);
        accountSol = await newAccountWithLamports(connection, fees);
    }

    const lamports = await connection.getBalance(payerAccount.publicKey);
    console.log(
        'Using account',
        payerAccount.publicKey.toBase58(),
        'containing',
        lamports / LAMPORTS_PER_SOL,
        'Sol to pay for fees',
    );
}

export const MintLayout = BufferLayout.struct([
    BufferLayout.u32('mintAuthorityOption'),
    Layout.publicKey('mintAuthority'),
    Layout.uint64('supply'),
    BufferLayout.u8('decimals'),
    BufferLayout.u8('isInitialized'),
    BufferLayout.u32('freezeAuthorityOption'),
    Layout.publicKey('freezeAuthority'),
]);

export async function createPairOfTokens(): Promise<void> {
    rentExemption = await connection.getMinimumBalanceForRentExemption(82);

    token = new Account();
    mintAccount1 = new Account();
    mintAccount2 = new Account();

    console.log('Creating token address 1', mintAccount1.publicKey.toBase58());
    console.log('Payer account:', payerAccount.publicKey.toBase58());

    const tx = new Transaction();

    tx.add(
        SystemProgram.createAccount({
            fromPubkey: payerAccount.publicKey,
            newAccountPubkey: mintAccount1.publicKey,
            lamports: rentExemption,
            space: MintLayout.span,
            programId: TOKEN_PROGRAM_ID,
        }),
    );

    let keys = [
        {pubkey: mintAccount1.publicKey, isSigner: false, isWritable: true},
        {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
    ];

    const commandDataLayout = BufferLayout.struct([
        BufferLayout.u8('instruction'),
        BufferLayout.u8('decimals'),
        Layout.publicKey('mintAuthority'),
        BufferLayout.u8('option'),
        Layout.publicKey('freezeAuthority'),
    ]);
    let data = Buffer.alloc(1024);
    {
        const encodeLength = commandDataLayout.encode(
            {
                instruction: 0,
                decimals: 18,
                mintAuthority: payerAccount.publicKey.toBuffer(),
                option: 1,
                freezeAuthority: payerAccount.publicKey.toBuffer(),
            },
            data,
        );
        data = data.slice(0, encodeLength);
    }

    let tx2 = new TransactionInstruction({
        keys: keys,
        programId: TOKEN_PROGRAM_ID,
        data: data,
    });

    tx.add(tx2);

    await sendAndConfirmTransaction(
        'createAccount and InitializeMint',
        connection,
        tx,
        payerAccount, 
        mintAccount1,
        // mintAccount,
    );

    console.log('Creating token address 2', mintAccount2.publicKey.toBase58());
    console.log('Payer account:', payerAccount.publicKey.toBase58());

    const newtx = new Transaction();

    newtx.add(
        SystemProgram.createAccount({
            fromPubkey: payerAccount.publicKey,
            newAccountPubkey: mintAccount2.publicKey,
            lamports: rentExemption,
            space: MintLayout.span,
            programId: TOKEN_PROGRAM_ID,
        }),
    );

    let newkeys = [
        {pubkey: mintAccount2.publicKey, isSigner: false, isWritable: true},
        {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
    ];

    const newcommandDataLayout = BufferLayout.struct([
        BufferLayout.u8('instruction'),
        BufferLayout.u8('decimals'),
        Layout.publicKey('mintAuthority'),
        BufferLayout.u8('option'),
        Layout.publicKey('freezeAuthority'),
    ]);
    let newdata = Buffer.alloc(1024);
    {
        const encodeLength = newcommandDataLayout.encode(
            {
                instruction: 0,
                decimals: 18,
                mintAuthority: payerAccount.publicKey.toBuffer(),
                option: 1,
                freezeAuthority: payerAccount.publicKey.toBuffer(),
            },
            newdata,
        );
        newdata = newdata.slice(0, encodeLength);
    }

    let newtx2 = new TransactionInstruction({
        keys: newkeys,
        programId: TOKEN_PROGRAM_ID,
        data: newdata,
    });

    newtx.add(newtx2);

    await sendAndConfirmTransaction(
        'createAccount and InitializeMint',
        connection,
        newtx,
        payerAccount, 
        mintAccount2,
    );
}

// export async function mintToPayerForBothTokens(): Promise<void> {
//     const dataLayout = BufferLayout.struct([
//         BufferLayout.u8('instruction'),
//         Layout.uint64('amount'),
//     ]);
// 
//     const data = Buffer.alloc(dataLayout.span);
//     dataLayout.encode(
//         {
//             instruction: 7,
//             amount: new u64(amount).toBuffer(),
//         },
//         data,
//     );
// 
//     let keys = [
//         {pubkey: mint,          isSigner: false, isWritable: true},
//         {pubkey: payerAccount,  isSigner: false, isWritable: true},
//     ];
//     keys.push({
//         pubkey: mint,
//         isSigner: true,
//         isWritable: false,
//     });
// 
//     let tx1 = new TransactionInstruction({
//         keys: keys,
//         programId: mintAccount1,
//         data: data,
//     });
//     let tx2 = new TransactionInstruction({
//         keys: keys,
//         programId: mintAccount2,
//         data: data,
//     });
// }

export async function loadProgram(): Promise<void> {
    const store = new Store();

    try {
        const config = await store.load('config.json');
        const tempprogramId = new PublicKey(config.programId);
        await connection.getAccountInfo(tempprogramId);
        console.log('Program already loaded to account:', tempprogramId.toBase58());
        return;
    } catch (err) {
        // try to load the program
    }

    // load the program
    console.log('Loading structured product program...');
    const data = await fs.readFile(pathToProgram);
    const programAccount = new Account();
    await BpfLoader.load(
        connection,
        payerAccount,
        programAccount,
        data,
        BPF_LOADER_PROGRAM_ID,
    );
    const tempprogramId = programAccount.publicKey;
    console.log('program loaded to account:', tempprogramId.toBase58());
}

export async function createAddresses(): Promise<void> {
    console.log('Creating two asset address...');

    const asset1seed = seed1.toBuffer();
    const asset2seed = seed2.toBuffer();
    
    const prog_token_addr1 = PublicKey.findProgramAddress([asset1seed], mintAccount1.publicKey);
    const prog_token_addr2 = PublicKey.findProgramAddress([asset2seed], mintAccount2.publicKey);

    let keys = [
        {pubkey: mintAccount1, isSigner: false, isWritable: true},
        {pubkey: mintAccount2, isSigner: false, isWritable: true},
        {pubkey: prog_token_addr1, isSigner: false, isWritable: true},
        {pubkey: prog_token_addr2, isSigner: false, isWritable: true},

    ];

}
