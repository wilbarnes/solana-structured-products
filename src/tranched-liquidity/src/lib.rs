use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    info,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use spl_token::*;

entrypoint!(process_instruction);
fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    info!(&format!(
        "process_instruction: {}: {} accounts, data={:?}",
        program_id,
        accounts.len(),
        instruction_data
    ));

    match instruction_data.get(0) {
        Some(0) => {
            info!("Adding asset reserve to the structured investment...");
            
            // TODO: some authentication, only allowed to be done by fund managers

            let account_info_iter = &mut accounts.iter();

            let ext_spl_token_mint      = next_account_info(account_info_iter)?; // external spl token mint
            let program_token_info      = next_account_info(account_info_iter)?; // associated account
            let system_program_info     = next_account_info(account_info_iter)?;
            let funder_info             = next_account_info(account_info_iter)?;
            let spl_token_program_info  = next_account_info(account_info_iter)?;
            let rent_sysvar_info        = next_account_info(account_info_iter)?;
            let rent                    = &Rent::from_account_info(rent_sysvar_info)?;

            let (
                program_token_address,      // Pubkey, valid program address
                program_token_bump_seed     // u8, bump seed
            ) =
                Pubkey::find_program_address(
                    &[
                         &spl_token::id().to_bytes(),
                         &ext_spl_token_mint.key.to_bytes(),
                    ], 
                    program_id,
            );

            if program_token_address != *program_token_info.key {
                info!("Error: program token asset 1 address derivation mismatch");
                return Err(ProgramError::InvalidArgument);
            }

            let program_token_signer_seeds: &[&[_]] = &[
                 &spl_token::id().to_bytes(),
                 &ext_spl_token_mint.key.to_bytes(),
                 &[program_token_bump_seed],
            ];

            invoke_signed(
                &system_instruction::create_account(
                    funder_info.key,
                    program_token_info.key,
                    1.max(rent.minimum_balance(spl_token::state::Account::get_packed_len())),
                    spl_token::state::Account::get_packed_len() as u64,
                    &spl_token::id(),
                ),
                &[
                    funder_info.clone(),
                    program_token_info.clone(),
                    system_program_info.clone(),
                ],
                &[&program_token_signer_seeds],
            )?;

            info!("Initializing asset reserve account");
            invoke(
                &spl_token::instruction::initialize_account(
                    &spl_token::id(),
                    program_token_info.key,
                    ext_spl_token_mint.key,
                    program_token_info.key,
                )?,
                &[
                    program_token_info.clone(),
                    ext_spl_token_mint.clone(),
                    spl_token_program_info.clone(),
                    rent_sysvar_info.clone(),
                ],
            )?;

            Ok(())
        }
        Some(1) => {
            info!("depositing assets into the vault");
            let account_info_iter = &mut accounts.iter();

            let wallet_address          = next_account_info(account_info_iter)?; // wallet address
            let program_token_info      = next_account_info(account_info_iter)?; // associated account
            let col_authority_info      = next_account_info(account_info_iter)?;

            let collateral_token_info   = next_account_info(account_info_iter)?;
            let spl_token_program_info  = next_account_info(account_info_iter)?;
            let rent_sysvar_info        = next_account_info(account_info_iter)?;

            let rent                    = &Rent::from_account_info(rent_sysvar_info)?;

            let (
                collateral_auth_address,
                collateral_auth_bump_seed 
            ) = 
                Pubkey::find_program_address(
                    &[br"collateral-auth-a"],
                    program_id,
                );

            if collateral_auth_address != *col_authority_info.key {
                info!("Error: collateral token mismatch");
                return Err(ProgramError::InvalidArgument);
            }

            let col_authority_signer_seeds: &[&[_]] = &[
                br"collateral-auth-a",
                &[collateral_auth_bump_seed],
            ];

            // transfer from user wallet to dest reserve
            // requires approval from user wallet
            // invoke_signed(
            //     &spl_token::instruction::transfer(
            //         &spl_token::id(),
            //         wallet_address.key,             // writable
            //         program_token_info.key,         // writable
            //         col_authority_info.key,         // signer
            //         &[],
            //         1_000_000,
            //     )?,
            //     &[
            //         wallet_address.clone(),         // src
            //         program_token_info.clone(),     // dst
            //         col_authority_info.clone(),     // mint auth
            //         spl_token_program_info.clone(), // spl id
            //     ],
            //     &[&col_authority_signer_seeds],
            // );
            // mint collateral token to user
            // need to create wallet account for user
            invoke_signed(
                &spl_token::instruction::mint_to(
                    &spl_token::id(),
                    collateral_token_info.key,
                    wallet_address.key,
                    col_authority_info.key,
                    &[],
                    1_000_000,
                )?,
                &[
                    collateral_token_info.clone(),  // mint
                    wallet_address.clone(),         // dst
                    col_authority_info.clone(),     // mint auth
                    spl_token_program_info.clone(), // spl id
                ],
                &[&col_authority_signer_seeds],
            );
            Ok(())
        }
        _ => {
            info!("Error: Unsupported instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

#[cfg(test)]
mod test {
    #![cfg(feature = "test-bpf")]

    use super::*;
    use assert_matches::*;
    use solana_program::{
        instruction::{AccountMeta, Instruction},
        sysvar,
    };
    use solana_program_test::*;
    use solana_sdk::{signature::Signer, transaction::Transaction};

    fn program_test(program_id: Pubkey, spl_one: Pubkey, spl_two: Pubkey) -> ProgramTest {
        let mut pc = ProgramTest::new(
            "bpf_program_template",
            program_id,
            processor!(process_instruction),
        );

        // Add SPL Token program
        pc.add_program(
            "spl_token",
            spl_token::id(),
            processor!(spl_token::processor::Processor::process),
        );

        pc
    }

    #[tokio::test]
    async fn test_create_then_close() {
        let program_id  = Pubkey::new_unique();
        
        let spl_one = Pubkey::new_unique();
        let spl_two = Pubkey::new_unique();

        let (mut banks_client, payer, recent_blockhash) = program_test(
            program_id,
            spl_one,
            spl_two
        ).start().await;

        let program_token_address =
            Pubkey::find_program_address(&[br"program-token"], &program_id).0;

        // Create the program-owned token account
        let mut transaction = Transaction::new_with_payer(
            &[Instruction {
                program_id,
                accounts: vec![
                    AccountMeta::new(program_token_address, false),
                    // program_token_address uses the base program's programId
                    AccountMeta::new(program_token_address, false),
                    // payer (funder)
                    AccountMeta::new(payer.pubkey(), true),
                    // native mint for SOL wrapping ???
                    AccountMeta::new_readonly(spl_token::native_mint::id(), false),
                    AccountMeta::new_readonly(solana_program::system_program::id(), false),
                    AccountMeta::new_readonly(spl_token::id(), false),
                    AccountMeta::new_readonly(sysvar::rent::id(), false),
                ],
                data: vec![0],
            }],
            Some(&payer.pubkey()),
        );
        transaction.sign(&[&payer], recent_blockhash);
        assert_matches!(banks_client.process_transaction(transaction).await, Ok(()));

        // Fetch the program-owned token account and confirm it now exists
        let program_token_account = banks_client
            .get_account(program_token_address)
            .await
            .expect("success")
            .expect("some account");

        let program_token_account =
            spl_token::state::Account::unpack_from_slice(&program_token_account.data)
                .expect("unpack success");
        assert_eq!(program_token_account.mint, spl_token::native_mint::id());
        assert_eq!(program_token_account.owner, program_token_address);

        // Close the the program-owned token account
        let mut transaction = Transaction::new_with_payer(
            &[Instruction {
                program_id,
                accounts: vec![
                    AccountMeta::new(program_token_address, false),
                    AccountMeta::new(payer.pubkey(), true),
                    AccountMeta::new_readonly(spl_token::id(), false),
                ],
                data: vec![1],
            }],
            Some(&payer.pubkey()),
        );
        transaction.sign(&[&payer], recent_blockhash);
        assert_matches!(banks_client.process_transaction(transaction).await, Ok(()));

        // Fetch the program-owned token account and confirm it no longer now exists
        assert_eq!(
            banks_client
                .get_account(program_token_address)
                .await
                .expect("success"),
            None
        );
    }
}
