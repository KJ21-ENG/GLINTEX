# Data Models - Backend (Prisma/PostgreSQL)

Primary schema file: `apps/backend/prisma/schema.prisma`

## Core Master Data
- `Item`, `Yarn`, `Cut`, `Twist`, `Firm`, `Supplier`, `Machine`, `Operator`, `Bobbin`, `RollType`, `ConeType`, `Wrapper`, `Box`

## Inventory and Process Flows
- Inbound: `Lot`, `InboundItem`
- Cutter: `IssueToCutterMachine`, `IssueToCutterMachineLine`, `ReceiveFromCutterMachineUpload`, `ReceiveFromCutterMachineRow`, `ReceiveFromCutterMachineChallan`, `ReceiveFromCutterMachinePieceTotal`
- Holo: `IssueToHoloMachine`, `ReceiveFromHoloMachineRow`, `ReceiveFromHoloMachinePieceTotal`
- Coning: `IssueToConingMachine`, `ReceiveFromConingMachineRow`, `ReceiveFromConingMachinePieceTotal`

## Operations and System
- Settings/config: `Settings`, `GoogleDriveCredential`, `Sequence`, `HoloIssueSequence`, `ConingIssueSequence`, `WhatsappTemplate`, `StickerTemplate`
- Access and identity: `Role`, `User`, `UserRole`, `UserSession`
- Logs and ledgers: `AuditLog`, `IssueTakeBack`, `IssueTakeBackLine`, `BoilerSteamLog`
- Customer fulfillment: `Customer`, `Dispatch`, `DispatchSequence`, `BoxTransfer`, `DocumentMessage`

## Notable Modeling Characteristics
- Many operational rows use `isDeleted` soft-delete flags.
- JSON fields are used for traceability and source mapping (e.g., `receivedRowRefs`, `sourceRowRefs`, `changeLog`).
- IDs mostly use `cuid()`; certain sequence-backed entities use explicit string/int IDs.

