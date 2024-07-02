# Express TypeScript API


## Prerequisites
- Node.js
- npm or yarn
- A .env file with necessary configurations

## Installation
1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```
2. **Install dependencies:**
   ```bash
    npm install
    # or
    yarn install
   ```
3. **Create a .env file:**
   ```bash
    BUCKET=<your-public-bucket-url>
    ENV=<your-environment (e.g., 'devnet')>
    PORT=<your-port (default: 3000)>
    NODE_ENV=<your-node-env (e.g., 'development')>
    URL=<your-production-url>
   ```   
3. **Start the server**
   ```bash
    npm run dev
    # or
    yarn dev
   ```   
   
## Routes
```GET /blinks/deposit?token=<token>&ref=<referralCode>```

```POST /transactions/deposit?token=<token>&amount=<amount>&ref=<referralCode>```
```
Content-Type: application/json
{
  "account": "<account-public-key>"
}
```