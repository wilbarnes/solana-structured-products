# solana-structured-products

Wil Barnes
currently independently R&Ding structured products and yield strategies
previously smart contracts dev @ Maker Foundation and ConsenSys

## Goal
To build a structured product allowing users to match and lock single deposits with the shared goal of executing a particular trading strategy, coupled with position management bots that read and respond to SerumDEX market data.

## Outcome
While the project is not complete, the research and work I present in this doc gives plenty evidence that this product can be built. 

I'd like to ask that this submission be judged on feasibility and any prize money awarded as a grant to continue implementing the product.

I am very interested in continuing to build this product.

### Quickstart

`npm install` in root, and `cargo build-bpf` in `src/tranched-liquidity/`.

While in `src/client/`, run `ts-node main.ts` to deploy two SPL-tokens (for individual assets) and program-associated accounts, but not yet mint and transfer assets to that intermediary account. Once this step is complete, this script will perform the following:

1. Deploy two SPL-Tokens (to mock two separate assets (e.g. USDC and YFI)).
2. Mint tokens to a user for each SPL token.
3. Call the vault program, which will create an intermediary account for the user to fund.
4. User funds the intermediary accound, and the funds are routed to a pool program.
5. Pool does actions.
6. Both users withdraw their funds (though a structured product will most likely require locked assets with a maturity date).

**NOTE:** it is not complete, I just simply didn't have the time to implement much.

# What is the product?

There is currently a product gap in single-sided digital structured product exposure. Users are generally asked to pair assets into pools and assume any impermanent loss. There exist AMMs that allow single-asset joining (for example: Balancer), though joining a pool is the equivalent of using the single asset to market buy the other assets in the pool at the AMM's prices.

Solana is a better fit for this product because it delivers on speed, scalability, and decentralization. Further, Solana is emerging quickly as a defi stronghold, and through the implementation of structured product primities that trend will accelerate.

The product is modular, and the architecture is as follows:

- Vault Program
- Pool Program (Serum's pool code or a variant)
- Drone (a simple offchain program)

The vault and pool are two known defi terms, though we'll define them explicitly for this document: a vault exists to hold and route assets, while a pool holds and performs conditional actions on those assets (e.g. swapping, repaying/drawing debt, farming yield).

The drone is the off-chain worker, or in other parlance: "keeper", "bot", that performs a specific range of actions on the previous three programs. This document will not discuss it in significant detail, as I feel it's an easier implementation and is of no use until the Solana Vault / Pool programs are deployed.

## This seems just like X, Y, Z on Ethereum..

Sure, though the same could be said aboout Ethereum products and traditional finance.

The intricacy of algorithmic market-making and arbitrage on Ethereum is immense, though I'm interested in porting these primitives into a high-throughput, scalable layer 1.

### Structured Product Example 1

Alice is looking for stable yield and she has Compound cToken-USDC
1. Alice wormholes her cToken-USDC into a single-asset Solana vault
2. Her cToken-USDC is rapidly deployed to low interest strategies for mere pennies, re-deploying hourly to the best yielding positions.


### Structured Product Example 2

Let's go a step further:
Alice is looking for stable yield and she has Compound cToken-USDC.
Charlie is looking for outsized yield, has only cold, hard YFI and wants to maintain total exposure to the asset. 

Alice and Charlie will enter into a junior / senior debt structured product. Alice's cToken-USDC is senior debt, Charlie's YFI is junior debt.

1. Alice wormholes her cToken-USDC into a single-asset Solana vault.
2. Charlie wormholes his YFI into a single-asset Solana vault.
3. The pool deploys the strategies together and farms yield.
4. The drone frequently pings the pool program to check health of the position.
5. If YFI trends aggressively downward beyond an agreed upon threshold, the assets are withdrawn and a portion of Charlie's YFI is sold on the open market for cToken-USDC to keep Alice's principal & interest whole.
6. If YFI trends aggressively upward, a portion of Charlie's YFI is sold on the open market to keep Alice's principal & interest whole.

Note: the above seems counter-intuitive, but in a 50%/50% YFI/stable pair, if YFI doubles in value the stable asset will experience 5.72% IL (source: https://baller.netlify.app/)



# Specs

# Vault Program

## Vault State

### Key-value "mapping" for account => amount deposited

What is being stored: the amount of assets Alice has deposited to her intermediary account.

A key-value store is needed for the user account to amount of asset deposited relationship, and the best way I have found to handle this is to make many accounts, with the depositing account being recorded as the key, with all accounts being owned by the program. When the program sees that the transaction has been signed with the user's pre-determined keypair, it returns the funds to the created account.

### Asset Pair Data

What is being stored: decimal values for each asset, total deposited, asset cap, and similar. To be determined later.

### SPL Token accounts for reserves of the asset

A deposit can't always be expected to match immediately with another asset. So akin to the Yearn vault -> controller -> strategy relationship, transitory assets will sit in the SPL token account until they can be matched and deployed to a pool.

`fn process_instruction(program_id, accounts, instruction_data) -> ProgramResult;`

Checks `instruction_data` first, then routes to the appropriate command. In the future, will move all instruction logic to `instruction.rs`.

## Instructions
`match instruction_data.get(number)`

### Instruction 0: creating a user deposit account

Instruction 0 calls result in the vault program creating a personal program-associated intermediary account for the user to fund.

For example, if Alice is depositing aDAI, then the account is created on the SPL aDAI program that is signable by the Vault program. The Vault program can do all of the SPL token actions on this program-associated account.

### Instruction 1: delegate or stake assets

Instruction 1 occurs after the user has deposited their assets into their program-associated account, deploying their assets to a specific pool. For single-assets, this means being deposited somewhere to start earning interest. Assets start earning interest when staked.

Calls to instruction 0 create a personal program-associated account where the user will deposit their assets. This program-associated account is signable by the program, but resides as an account on the desired SPL token, making it trivial for the user to just deposit however much of the asset they want to it.

### Instruction 2: receive or unstake assets

Instruction 2 is the reverse of instruction 1, user assets are retrieved. 

### Instruction 2: balancing the product ("crank" turning)

Instruction 2 is similar to what Serum refers to as "crank turning", trading in/out of the pool, and any transaction will push the chain forward. 

Essentially, this instruction will check current market conditions and enforce any conditional logic if one or both of the assets are moving adversely.


# Pool Program

I found Serum pool WIP info from [this Google doc](https://docs.google.com/document/d/1lmMZRKkxMFOtGOEZOFEKYL7syqv-4QT87F0o55fc35Y/edit) and [this repo](https://github.com/project-serum/serum-dex/tree/pool-wip/pool).

`pub fn pool_entrypoint<P: pool::Pool>(program_id, accounts, instruction_data) -> ProgramResult`

I still don't entirely understand how the pool works, so I'm going to provide my general thoughts on how the pool will operate -- subject to change as I continue learning how Solana holistically works with deployed programs. 

The pool's context is held in the `pub struct PoolContext` struct, which has the general Solana program variables: `programId` of the pool, `pool_account` that holds the pool state, `pool_token_mint` that holds the token mint for the pool token we'll be minting for users who deposit assets, and the `pool_vault_accounts` that are the SPL token accounts for each of the assets owned by the pool.

Solana's scalability and speed coupled with the data found in the specific pool accounts, we can create an arbitrage / position management bot that can:
- move assets in and out of Automated Market Makers (AMMs).
- market sell a pool asset (to protect the other pool asset(s)).
- instead of distributing LP token to users, users can elect that their LP tokens are redeposited into AMMs to provide liquidity for other users who want to swap in and out of LP positions.
- monitor Serum's on-chain limit orderbooks for large buy / sell walls.

## Personal Pain Points

- I may be mistaken, when I started working with the Solana Rust repo, the BpfLoader code wasn't complete, so I used the solana/web3.js library. I would've preferred to use Rust entirety, and I was wondering why the rust library didn't implement all the native functions.
- Documentation is good. Overall, it's just a matter of learning new interfaces, program entrypoints, and account management.

## Personal Knowledge Gaps To Address

- Improve understanding of account management. It's still a little fuzzy how to manage accounts in Solana and with SPL Tokens.
    - In my code in the repo, I learned how to utilize `find_program_address` to create a program-associated account for particular SPL tokens, but need more experience sending / receiving between accounts and program-associated accounts.
- Further experimenting with `invoke_signed` for interacting with other programs (SerumDEX, SerumSWAP, and alike).
- Learn more about how "crank turning" works and implement similar functionality for the bot.

## Continued Development

I'm very interested in continuing to develop the idea now that I'm beyond the initial learning curve. The immediate next steps I see are:
1. Finish the vault deposit and accounting logic with tests.
2. Learn more and contribute to the Serum Pool WIP. A more feature complete and documented pool primitive will help the greater community.
3. Experiment with and implement structured product pool logic for various investment strategies.
