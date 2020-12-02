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
    sendAndConfirmTransaction,
} from '@solana/web3.js';

import {
    Token,
} from '@solana/spl-token';

import * as Layout from './layout';

import fs from 'mz/fs';

// import {sendAndConfirmTransaction} from './utils/send-and-confirm-transactions';
import {newAccountWithLamports} from './utils/new-account-with-lamports';
import {Store} from "./utils/store";

// @ts-ignore
import BufferLayout from 'buffer-layout';

let accountUsdc: Account;
let accountSol: Account;

// structured product account
let programAccount: Account;

let payerAccount: Account;
let payerAccount2: Account;
let connection: Connection;
let rentExemption: number;
let token: Account;

let tokenAccount1: Account;
let tokenAccount2: Account;

let freezeAccount: Account;

const pathToProgram = '../tranched-liquidity/target/bpfel-unknown-unknown/release/tranched_liquidity.so'

const TOKEN_PROGRAM_ID: PublicKey = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

const ASSOC_TOKEN_ID: PublicKey = new PublicKey(
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

const SYSTEM_PROGRAM_ID: PublicKey = new PublicKey(
    '11111111111111111111111111111111',
);

const NATIVEMINT_PROGRAM_ID: PublicKey = new PublicKey(
    'So11111111111111111111111111111111111111112',
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

        console.log('amount of fees:', fees);

        payerAccount = await newAccountWithLamports(connection, 4911830720);
        payerAccount2 = await newAccountWithLamports(connection, 4911830720);
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
    tokenAccount1 = new Account();
    tokenAccount2 = new Account();

    console.log('Creating token address 1', tokenAccount1.publicKey.toBase58());
    console.log('Payer account:', payerAccount.publicKey.toBase58());

    const tx = new Transaction();

    tx.add(
        SystemProgram.createAccount({
            fromPubkey: payerAccount.publicKey,
            newAccountPubkey: tokenAccount1.publicKey,
            lamports: rentExemption,
            space: MintLayout.span,
            programId: TOKEN_PROGRAM_ID,
        }),
    );

    let keys = [
        {pubkey: tokenAccount1.publicKey, isSigner: false, isWritable: true},
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
                option: 0,
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
        connection,
        tx,
        [payerAccount, tokenAccount1],
        {
            commitment: 'singleGossip',
            preflightCommitment: 'singleGossip',
        },
    )
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
//         programId: tokenAccount1,
//         data: data,
//     });
//     let tx2 = new TransactionInstruction({
//         keys: keys,
//         programId: tokenAccount2,
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
    programAccount = new Account();
    await BpfLoader.load(
        connection,
        payerAccount,
        programAccount,
        data,
        BPF_LOADER_PROGRAM_ID,
    );
    // prodProgramId = programAccount.publicKey;
    console.log('program loaded to account:', programAccount.publicKey.toBase58());
}

export async function createAddresses(): Promise<void> {
    console.log('Creating an asset address...');
    // payerAccount2 = new Account();

    const newToken: Token = await Token.createMint(
        connection,
        payerAccount,
        payerAccount.publicKey,
        null,
        6,
        TOKEN_PROGRAM_ID,
    );
    console.log('token programId:', newToken.publicKey.toBase58());

    let newAccount1 = await newToken.createAccount(
        payerAccount.publicKey,
    );
    console.log('newAccount1', newAccount1.toBase58());

    let newAccount2 = await newToken.createAccount(
        payerAccount.publicKey,
    );
    console.log('newAccount2', newAccount2.toBase58());

    await newToken.mintTo(
        newAccount1,
        payerAccount.publicKey,
        [],
        1337000000,
    );

    let txSig = await newToken.transfer(
        newAccount1,
        newAccount2,
        payerAccount,
        [],
        731000000,
    );

    let myAccountInfo1 = await newToken.getAccountInfo(
        newAccount1,
    );
    console.log('myaccountinfo1:', myAccountInfo1);
    console.log('new account 1 mint:', myAccountInfo1.mint.toBase58());

    // const asset1seed = Buffer.from(newAccount1, 'utf8');

    const [
        prog_token_addr, 
        bump_seed
    ] = await PublicKey.findProgramAddress(
        [
            newAccount1.toBuffer(), 
            TOKEN_PROGRAM_ID.toBuffer(),
            newToken.publicKey.toBuffer()
        ], 
        ASSOC_TOKEN_ID, 
    );

    console.log('prog_token_addr:', prog_token_addr.toBase58());

    let keys = [
        {pubkey: newAccount1,               isSigner: false, isWritable: false},
        {pubkey: newToken.publicKey,        isSigner: false, isWritable: false},
        {pubkey: prog_token_addr,           isSigner: false, isWritable: false},
        {pubkey: SYSTEM_PROGRAM_ID,         isSigner: false, isWritable: false},
        {pubkey: NATIVEMINT_PROGRAM_ID,     isSigner: false, isWritable: false},
        {pubkey: payerAccount.publicKey,    isSigner: true,  isWritable: true },
        {pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false},
        {pubkey: SYSVAR_RENT_PUBKEY,        isSigner: false, isWritable: false},
    ];

    const commandDataLayout = BufferLayout.struct([
        BufferLayout.u8('instruction'),
    ]);
    let data = Buffer.alloc(1024);
    {
        const encodeLength = commandDataLayout.encode(
            {
                instruction: 2
            },
            data,
        );
        data = data.slice(0, encodeLength);
    }

    const tx = new Transaction();
    let instr = new TransactionInstruction({
        keys: keys,
        programId: programAccount.publicKey,
        // programId: TOKEN_PROGRAM_ID,
        data: data,
    });
    tx.add(instr);

    console.log('payerAccount:', payerAccount.publicKey);
    console.log('programAccount:', programAccount.publicKey);

    await sendAndConfirmTransaction(
        connection,
        tx,
        [payerAccount],
        {
            commitment: 'singleGossip',
            preflightCommitment: 'singleGossip',
        },
    )

    console.log('prog_token_addr:', prog_token_addr);
    let txSig2 = await newToken.transfer(
        newAccount1,
        prog_token_addr,
        payerAccount,
        [],
        13000000,
    );
}

export async function transferToCreatedAccount(): Promise<void> {

}
