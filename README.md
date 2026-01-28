# Solana: Create Account and Transfer in Single Transaction

A step-by-step implementation of creating a new account and funding it with SOL in a **single atomic transaction** on Solana Devnet.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
SENDER_SECRET_KEY=your_base58_encoded_secret_key
```

## How It Works

The script demonstrates how to combine multiple instructions into a single transaction:

1. **Connect to Devnet** - Establish RPC connection to Solana Devnet
2. **Load Payer Keypair** - Import sender from base58-encoded secret key
3. **Create Account Instruction** - Manually build CreateAccount instruction
4. **Create Transfer Instruction** - Manually build Transfer instruction
5. **Combine Instructions** - Add both instructions to a single transaction
6. **Get Recent Blockhash** - Fetch latest blockhash for transaction validity
7. **Sign Transaction** - Sign with both payer and new account keypair
8. **Send & Confirm** - Serialize, submit to network, and wait for confirmation

## Key Features

- **Manual Instruction Construction**: Shows how to manually create SystemProgram instructions (CreateAccount & Transfer)
- **Atomic Operations**: Both account creation and funding happen in a single transaction
- **Error Handling**: Catches and logs transaction errors with detailed logs
- **Explorer Link**: Prints transaction explorer link for easy verification

## Run

```bash
npx ts-node src/index.ts
```
