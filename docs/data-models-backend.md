# Data Models

## Backend Schema (Prisma)

The application models a complex manufacturing lifecycle: Inbound -> Cutter -> Holo -> Coning -> Dispatch/Boiler.

### Core Inventory Entities
- **Item**: Master list of core items.
- **Yarn, Cut, Twist**: Material types and sub-attributes.
- **Firm, Supplier**: Venders and sources.
- **Lot**: Groups of inbound shipments.
- **InboundItem**: The atomic raw material unit arriving at the factory.

### Manufacturing and Processing Entities
- **Machine, Operator, Bobbin, Box, RollType, ConeType, Wrapper**: Configuration entities used during processing stages.
- **IssueToCutterMachine / ReceiveFromCutterMachineRow**
- **IssueToHoloMachine / ReceiveFromHoloMachineRow**
- **IssueToConingMachine / ReceiveFromConingMachineRow**

### Feature Modules
- **Dispatches**: Send out completed goods (`Customer`, `Dispatch`, `DocumentMessage`).
- **BoxTransfer**: Move goods between packaging boxes tracking from/to IDs.
- **IssueTakeBack**: Handle returned material from an uncompleted machine run back to prior stage/inventory stock (`IssueTakeBack`, `IssueTakeBackLine`).
- **BoilerSteamLog**: Specifically marking Holo rolls that went through steaming.

### System Entities
- **User, Role, UserRole, UserSession**: Authentication array with robust RBI-like scope verification via JSON configurations.
- **Settings**: Dynamic configuration.
- **GoogleDriveCredential**: Drive sync tokens.
- **WhatsappTemplate**: WhatsApp messages triggers.
- **StickerTemplate**: ZPL/DPL-like dimensions for print labels.
- **AuditLog**: Comprehensive CRUD and operational logging.
