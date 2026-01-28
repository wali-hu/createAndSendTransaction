import {
    Connection,       // RPC ke through cluster se baat karne ke liye.
    Keypair,          // private/public key pair; yahi signer hota hai.
    PublicKey,        // public address (base58 string se PublicKey object).
    SystemProgram,    // built‑in program jo SOL transfer, account create, etc karta hai.
    Transaction,      // jo actual transaction container hai.
    LAMPORTS_PER_SOL, //  SOL → lamports conversion constant.
    clusterApiUrl,    // cluster ke RPC URL ko get karne ke liye.
    TransactionInstruction, // Manually instruction create karne ke liye.
} from '@solana/web3.js';
import bs58 from 'bs58'; // Base58 encoding/decoding ke liye.
import dotenv from 'dotenv';
dotenv.config(); 

/* 
1. Devnet pe connect 

Under the hood: Connection WebSocket + HTTP RPC clients internally create karta hai, jo getRecentBlockhash, sendRawTransaction, etc expose karte hain.

*/
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

const senderSecretKey = process.env.SENDER_SECRET_KEY;
const receiverPublicKey = process.env.RECEIVER_PUBLIC_KEY;

if (!senderSecretKey || !receiverPublicKey) {
  throw new Error('Missing required environment variables: SENDER_SECRET_KEY and RECEIVER_PUBLIC_KEY');
}

const payer = Keypair.fromSecretKey(bs58.decode(senderSecretKey));
const recipient = new PublicKey(receiverPublicKey);

// 2. Manual SystemProgram.transfer

// 2.1: Define Instruction index (discriminant) .
// System Program ke liye standard enum hota hai:
// enum SystemInstruction {
//   CreateAccount = 0,
//   Assign        = 1,
//   Transfer      = 2,
//   CreateAccountWithSeed = 3,
//   AdvanceNonceAccount   = 4,
//   WithdrawNonceAccount  = 5,
//   InitializeNonceAccount = 6,
//   AuthorizeNonceAccount  = 7,
//   Allocate               = 8,
//   AllocateWithSeed       = 9,
//   AssignWithSeed         = 10,
//   TransferWithSeed       = 11,
//   ...
// }
const TRANSFER_INSTRUCTION_INDEX = 2;

// 2.2: Transfer amount ko pure lamports mein calculate karo.
const lamportsToSend = 0.1 * LAMPORTS_PER_SOL;

// 2.3: Instruction data Buffer create karo.
// Layout: [u32: instruction_index][u64: lamports]
// Total: 4 bytes (u32) + 8 bytes (u64) = 12 bytes
const transferData = Buffer.alloc(4 + 8);

// u32 little-endian mein likho (instruction index = 2)
transferData.writeUInt32LE(TRANSFER_INSTRUCTION_INDEX, 0);

// u64 little-endian mein lamports likhna:
(transferData as any).writeBigUInt64LE(BigInt(lamportsToSend), 4);

// 2.4: Ab TransactionInstruction manually bana rahe hain:
const transferInstruction = new TransactionInstruction({
    programId: SystemProgram.programId, // 11111111111111111111111111111111
    keys: [
        {
            pubkey: payer.publicKey,
            isSigner: true,   // fromPubkey ko sign karna zaroori hai kyunki uska balance debit hoga
            isWritable: true, // SOL balance change hoga
        },
        {
            pubkey: recipient,
            isSigner: false,  // recipient ko sign karne ki zaroorat nahi
            isWritable: true, // uska balance bhi update hoga
        },
    ],
    data: transferData, // [u32 instruction_index][u64 lamports]
});


// EXTRA: CreateAccount / Assign / Allocate manually


/*
   1) CreateAccount (index = 0)

   Layout (data):
   [u32: CreateAccount(0)]
   [u64: lamports]         // naye account ko kitne lamports dene hain
   [u64: space]            // account data ke bytes ka size
   [32 bytes: owner pubkey] // jis program ka yeh account owned hoga (e.g. SystemProgram, Serum, custom program, etc)

   Keys:
   - [0] from (payer/ funder): signer + writable
   - [1] newAccount: signer + writable
*/
const CREATE_ACCOUNT_INDEX = 0;

function createAccountInstruction(
    fromPubkey: PublicKey,
    newAccountPubkey: PublicKey,
    lamports: number | bigint,
    space: number | bigint,
    owner: PublicKey,
): TransactionInstruction {
    // Data buffer length:
    // 4 (u32 index) + 8 (u64 lamports) + 8 (u64 space) + 32 (Pubkey)
    const buffer = Buffer.alloc(4 + 8 + 8 + 32);

    // Instruction index
    buffer.writeUInt32LE(CREATE_ACCOUNT_INDEX, 0);

    // lamports (u64 LE)
    (buffer as any).writeBigUInt64LE(BigInt(lamports), 4);

    // space (u64 LE)
    (buffer as any).writeBigUInt64LE(BigInt(space), 12);

    // owner pubkey (32 bytes)
    owner.toBuffer().copy(buffer, 20);

    return new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [
            {
                pubkey: fromPubkey,
                isSigner: true,  // funder must sign
                isWritable: true,
            },
            {
                pubkey: newAccountPubkey,
                isSigner: true,  // new account keypair must sign
                isWritable: true,
            },
        ],
        data: buffer,
    });
}

/*
   2) Assign (index = 1)

   Layout:
   [u32: Assign(1)]
   [32 bytes: new_owner_pubkey]

   Ye instruction sirf kisi account ke "owner" program ko change karta hai.
   Keys:
   - [0] account: signer + writable
*/
const ASSIGN_INDEX = 1;

function assignInstruction(
    accountPubkey: PublicKey,
    newOwner: PublicKey,
): TransactionInstruction {
    // 4 (index) + 32 (pubkey)
    const buffer = Buffer.alloc(4 + 32);

    // instruction index
    buffer.writeUInt32LE(ASSIGN_INDEX, 0);

    // new owner pubkey
    newOwner.toBuffer().copy(buffer, 4);

    return new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [
            {
                pubkey: accountPubkey,
                isSigner: true,   // account owner ko sign karna hota hai
                isWritable: true, // owner field change hogi
            },
        ],
        data: buffer,
    });
}

/*
   3) Allocate (index = 8)

   Layout:
   [u32: Allocate(8)]
   [u64: space]

   Ye instruction sirf account ka "allocated data size" set karta hai
   (ya badhata hai). Normal flow mein ye usually CreateAccount ke sath
   ya program-specific account flows mein use hota hai.

   Keys:
   - [0] account: signer + writable
*/
const ALLOCATE_INDEX = 8;

function allocateInstruction(
    accountPubkey: PublicKey,
    space: number | bigint,
): TransactionInstruction {
    const buffer = Buffer.alloc(4 + 8);

    buffer.writeUInt32LE(ALLOCATE_INDEX, 0);
    (buffer as any).writeBigUInt64LE(BigInt(space), 4);

    return new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [
            {
                pubkey: accountPubkey,
                isSigner: true,
                isWritable: true,
            },
        ],
        data: buffer,
    });
}

// =============================
// 3. Transaction Object
// =============================

/*
Under the hood: Transaction ek container hai jo multiple TransactionInstruction objects hold kar sakta hai.

Yeha Transaction ke andar abhi:

instructions: TransactionInstruction[] ki list.
Payer, blockhash, signatures abhi set nahi huay.

*/

const transaction = new Transaction();

// Example: naya account bhi banayein aur usko fund bhi karein in one tx
const newAccount = Keypair.generate();

// 3.1 CreateAccount instruction (payer -> newAccount)
const createIx = createAccountInstruction(
    payer.publicKey,
    newAccount.publicKey,
    0.2 * LAMPORTS_PER_SOL, // lamports for new account
    64n,                    // space (bytes) - demo value
    SystemProgram.programId // owner: SystemProgram (for demo; normally custom program)
);

// 3.2 Allocate instruction (increase space, purely for demo)
const allocateIx = allocateInstruction(
    newAccount.publicKey,
    128n, // new space size
);

// 3.3 Assign instruction (change owner, demo: assign back to SystemProgram itself)
const assignIx = assignInstruction(
    newAccount.publicKey,
    SystemProgram.programId,
);

// 3.4 Transfer instruction (manual transfer, jo upar banaya tha)
// Yahan transfer abhi `payer -> recipient` hai. Agar tum chaho to
// isko `payer -> newAccount` bhi bana sakte ho.
transaction.add(
    createIx,     // index = 0 (CreateAccount)
    allocateIx,   // index = 8 (Allocate)
    assignIx,     // index = 1 (Assign)
    transferInstruction, // index = 2 (Transfer)
);

// 3.5 Recent blockhash set karna zaroori hai taaki transaction valid ho.
const lastestBlockhash = await connection.getLatestBlockhash('confirmed');

/*
 latestBlockhash:
 {
   blockhash: string;
   lastValidBlockHeight: number;
 }

Old API getRecentBlockhash() tha, ab getLatestBlockhash recommended hai.
*/

console.log('Recent blockhah:', lastestBlockhash.blockhash);

// 3.6 Manually Transaction ke fields set karna
transaction.recentBlockhash = lastestBlockhash.blockhash;
transaction.feePayer = payer.publicKey;

/*

Ab:

feePayer → kisi ek signer ka pubkey jo fees pay karega.
recentBlockhash → is blockhash se tx ko tie kar diya; kuch slots ke baad invalid ho jayega.
Is point pe:

transaction.instructions: populated
transaction.recentBlockhash: set
transaction.feePayer: set
transaction.signatures: abhi empty / placeholder hai.

*/

// 4. Sign Transaction
transaction.sign(payer, newAccount);

/*

1. Transaction ko “message” mein convert karti hai:

    compileMessage():
        Unique account list banata hai.
        Header (numRequiredSignatures, numReadonlySignedAccounts, etc).
        Recent blockhash add karta hai.
        Instructions ko account indices + data ke sath encode karta hai.
    Ye sab milke ek Message banta hai (binary form).

2. Message ko serialize karta hai (message.serialize()).   

3. Har signer ke liye:

    ed25519 signature: sign(sha256(messageBytes)).
    Signature ek 64‑byte array hoti hai.

4. transaction.signatures array mein har signer ka { publicKey, signature } store karta hai.

*/

// 5. Raw serialize + send

const rawTransaction = transaction.serialize(); // Buffer of full tx data: Yeh buffer Network ko bheja jata hai via sendRawTransaction.

const txSignature  = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false, // By default preflight simulation run hoti hai
});
console.log('Submitted transaction siganture:', txSignature);

// 6. Confirm Transaction

const confirmation = await connection.confirmTransaction(
{
    signature: txSignature,
    blockhash: lastestBlockhash.blockhash,
    lastValidBlockHeight: lastestBlockhash.lastValidBlockHeight,
},
'confirmed'
);

/*

Yaha:

sendRawTransaction → RPC method sendTransaction call karta hai aur serialized bytes JSON base64 ke through bhejta hai.
confirmTransaction → blockhash / blockheight ke context mein wait karta hai ke tx finalized / confirmed ho jaye.

*/