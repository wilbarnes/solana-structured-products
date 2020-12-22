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
import {newAccountWithLamports} from './utils/new-account-with-lamports';
import {Store} from "./utils/store";

// @ts-ignore
import BufferLayout from 'buffer-layout';

let connection: Connection;
let rentExemption: number;

const pathToProgram = '../tranched-liquidity/target/deploy/tranched_liquidity.so'

// structured product program account
let programAccount: Account;
// payer, everything will be owned by this account
let payerAccount: Account;
// mint authority
let mintAuthAccount: Account;

// tokens & collateral tokens
let tokenA:     Token;
let colTokenA:  Token;
let userA1:     Account;
let userA2:     Account;
let accountA1:  PublicKey;
let accountA2:  PublicKey;

let tokenB:     Token;
let colTokenB:  Token;
let userB1:     Account;
let userB2:     Account;
let accountB1:  PublicKey;
let accountB2:  PublicKey;

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
        userA1       = await newAccountWithLamports(connection, 4911830720);
        userA2       = await newAccountWithLamports(connection, 4911830720);
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

export async function createTokensAndAddresses(): Promise<void> {
    console.log('Creating environment and addresses...');
    mintAuthAccount = new Account;
    console.log('mintAuthAccount:', mintAuthAccount.publicKey.toBase58());

    /*
     * CREATE TOKEN A
     * and CREATE TOKEN A ADDRESSES
     */
    tokenA = await Token.createMint(
        connection,
        payerAccount,
        mintAuthAccount.publicKey,
        null,
        6,
        TOKEN_PROGRAM_ID,
    );
    console.log('tokenA programId:', tokenA.publicKey.toBase58());

    // create account 1 for TOKEN A
    accountA1 = await tokenA.createAccount(
        userA1.publicKey,
    );
    // create account 2 for TOKEN A
    // userA2 = new Account;
    accountA2 = await tokenA.createAccount(
        userA2.publicKey,
    );
    console.log('USER A1:', userA1.publicKey.toBase58());
    console.log('USER A2:', userA2.publicKey.toBase58());

    /*
     * CREATE TOKEN B
     * and CREATE TOKEN B ADDRESSES
     */
    tokenB = await Token.createMint(
        connection,
        payerAccount,
        mintAuthAccount.publicKey,
        null,
        6,
        TOKEN_PROGRAM_ID,
    );
    console.log('tokenB programId:', tokenB.publicKey.toBase58());

    // create account 1 for TOKEN B
    userB1 = new Account;
    accountB1 = await tokenB.createAccount(
        userB1.publicKey,
    );
    // create account 2 for TOKEN B
    userB2 = new Account;
    accountB2 = await tokenB.createAccount(
        userB2.publicKey,
    );
    console.log('ACCOUNT B1:', userB1.publicKey.toBase58());
    console.log('ACCOUNT B2:', userB2.publicKey.toBase58());

    // create mint authority for collateral token A
    const [
        col_a_authority_info, 
        auth_bump_seed,
    ] = await PublicKey.findProgramAddress(
        [Buffer.from("collateral-auth-a", 'utf-8')], programAccount.publicKey,
    );
    console.log('MINT AUTHORITY CREATED');

    // collateral token A that users redeeem for underlying deposit
    colTokenA = await Token.createMint(
        connection,
        payerAccount,
        col_a_authority_info,
        null,
        6,
        TOKEN_PROGRAM_ID,
    );
    console.log('COL TOKEN A CREATED');
    console.log(mintAuthAccount.publicKey.toBase58());

    // mint TOKEN A tokens to A1/2
    await tokenA.mintTo(
        accountA1,
        mintAuthAccount,
        [],
        1337000000,
    );
    console.log('TOKEN A ACCOUNT A1 MINTED TO');
    await tokenA.mintTo(
        accountA2,
        mintAuthAccount,
        [],
        999000000,
    );

    // mint TOKEN B tokens to B1/2
    await tokenB.mintTo(
        accountB1,
        mintAuthAccount,
        [],
        1337000000,
    );
    await tokenB.mintTo(
        accountB2,
        mintAuthAccount,
        [],
        999000000,
    );
    console.log('TOKEN A and TOKEN B MINTED TO');

    let userA1Info = await tokenA.getAccountInfo(
        accountA1,
    );

    // console.log('ACCOUNT A1 INFO:', userA1Info);
    console.log('ACCOUNT A1 BASE58:', userA1Info.mint.toBase58());

    let userA2Info = await tokenA.getAccountInfo(
        accountA2,
    );

    // console.log('ACCOUNT A1 INFO:', userA1Info);
    console.log('ACCOUNT A1 BASE58:', userA1Info.mint.toBase58());

    const [
        prog_token_addr, 
        bump_seed
    ] = 
        await PublicKey.findProgramAddress(
            [
                TOKEN_PROGRAM_ID.toBuffer(),
                tokenA.publicKey.toBuffer()
            ], 
            programAccount.publicKey, 
    );

    console.log('prog_token_addr:', prog_token_addr.toBase58());

    let keys = [
        {pubkey: tokenA.publicKey,           isSigner: false, isWritable: false},
        {pubkey: prog_token_addr,            isSigner: false, isWritable: true },
        {pubkey: SYSTEM_PROGRAM_ID,          isSigner: false, isWritable: false},
        {pubkey: payerAccount.publicKey,     isSigner: true,  isWritable: true },
        {pubkey: TOKEN_PROGRAM_ID,           isSigner: false, isWritable: false},
        {pubkey: SYSVAR_RENT_PUBKEY,         isSigner: false, isWritable: false},
    ];

    const commandDataLayout = BufferLayout.struct([
        BufferLayout.u8('instruction'),
    ]);
    let data = Buffer.alloc(1024);
    {
        const encodeLength = commandDataLayout.encode(
            {
                instruction: 0
            },
            data,
        );
        data = data.slice(0, encodeLength);
    }

    const tx = new Transaction();

    let instr = new TransactionInstruction({
        keys: keys,
        programId: programAccount.publicKey,
        data: data,
    });
    tx.add(instr);

    console.log('payerAccount:', payerAccount.publicKey);
    console.log('programAccount:', programAccount.publicKey);
    console.log('prog_token_addr:', prog_token_addr);

    await sendAndConfirmTransaction(
        connection,
        tx,
        [payerAccount],
        {
            commitment: 'singleGossip',
            preflightCommitment: 'singleGossip',
        },
    )
    console.log('instruction 0 transaction was successful');

    let approvalSig = await tokenA.approve(
        accountA1,
        payerAccount.publicKey,
        userA1,
        [],
        13000000,
    );
    let txSig2 = await tokenA.transfer(
        accountA1,
        prog_token_addr,
        payerAccount,
        [],
        13000000,
    );
}

export async function depositAssets(): Promise<void> {

    // reserve account associated program account
    const [
        prog_token_addr, 
        bump_seed
    ] = 
        await PublicKey.findProgramAddress(
            [
                TOKEN_PROGRAM_ID.toBuffer(),
                tokenA.publicKey.toBuffer()
            ], 
            programAccount.publicKey, 
    );
    console.log('prog_token_addr:', prog_token_addr.toBase58());

    // collateral token A mint authority
    const [
        col_a_authority_info, 
        auth_bump_seed,
    ] = 
        await PublicKey.findProgramAddress(
            [
                Buffer.from("collateral-auth-a", 'utf-8')
            ], 
            programAccount.publicKey,
    );
    console.log('col_a_authority_info:', col_a_authority_info.toBase58());

    let approvalSig = await tokenA.approve(
        accountA1,
        col_a_authority_info,
        userA1,
        [],
        1000000,
    );
    let transferSig = await tokenA.transfer(
        accountA1,
        prog_token_addr,
        userA1,
        [],
        1000000,
    );

    let prog_addr_info = await tokenA.getAccountInfo(
        prog_token_addr,
    );

    // console.log('ACCOUNT A1 INFO:', userA1Info);
    console.log('>>>>> PROG_TOKEN_ADDR:', prog_addr_info.mint.toBase58());

    let keys = [
        {pubkey: accountA1,                  isSigner: false, isWritable: true },
        {pubkey: prog_token_addr,            isSigner: false, isWritable: true },
        {pubkey: col_a_authority_info,       isSigner: true , isWritable: false},

        {pubkey: colTokenA.publicKey,        isSigner: false, isWritable: true },
        {pubkey: TOKEN_PROGRAM_ID,           isSigner: false, isWritable: false},
        {pubkey: SYSVAR_RENT_PUBKEY,         isSigner: false, isWritable: false},
    ];

    const commandDataLayout = BufferLayout.struct([
        BufferLayout.u8('instruction'),
    ]);
    let data = Buffer.alloc(1024);
    {
        const encodeLength = commandDataLayout.encode(
            {
                instruction: 1
            },
            data,
        );
        data = data.slice(0, encodeLength);
    }

    const tx = new Transaction();

    let instr = new TransactionInstruction({
        keys: keys,
        programId: programAccount.publicKey,
        data: data,
    });
    tx.add(instr);

    console.log('payerAccount:', payerAccount.publicKey);
    console.log('programAccount:', programAccount.publicKey);
    console.log('prog_token_addr:', prog_token_addr);

    await sendAndConfirmTransaction(
        connection,
        tx,
        [payerAccount],
        {
            commitment: 'singleGossip',
            preflightCommitment: 'singleGossip',
        },
    )
}
