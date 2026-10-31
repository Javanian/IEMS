export interface EffectSession {readonly client:object;inTransaction():boolean}
type ClientSession=EffectSession;
interface MongoClient {startSession:(...args:any[])=>any}
interface Db {collection:(...args:any[])=>any}
import type {VerifiedScope, TenantFoundation} from '../tenant-foundation/index.d.ts';
declare const workerCapability: unique symbol;
export interface EffectWorkerCapability {readonly [workerCapability]: true}
export interface EffectGrant {tenantId:string;plantId:string;legalEntityId:string;userId?:string;membershipId?:string}
export interface EffectOwner {namespace:string;identity:Record<string,unknown>;hashField:string;payloadHash:string;resultPath?:string;resultHash?:string}
export interface EffectCommand {_id:string;tenantId:string;plantId:string;legalEntityId:string;owner:EffectOwner;actor:Record<string,unknown>;kind:string;plan:Record<string,any>;acceptedResult:Record<string,unknown>;state:string;version:number;epoch:number}
export interface EffectAttempt {_id:string;tenantId:string;commandId:string;phase:string;ordinal:number;fence:number;adapterId:string;instanceEpoch:string;providerKey:string;state:string;input:Record<string,any>;inputHash:string;observedOutcome?:Record<string,unknown>;phaseResult?:Record<string,unknown>}
export interface EffectOrigin {authorize(input:{command:EffectCommand;session:ClientSession;observation:boolean}):Promise<unknown>;context?:unknown}
export interface EffectPhase {command:EffectCommand;attempt:EffectAttempt;capability:EffectWorkerCapability;context?:unknown}
export interface EffectClaimPhase extends EffectPhase {session:ClientSession;phase:string}
export interface EffectPublicationPhase extends EffectPhase {session:ClientSession;observation:{result:Record<string,any>;proofHash:string}}
export interface EffectHandler {reviewRetry?(input:{command:EffectCommand;attempt:EffectAttempt;grant:EffectGrant;reviewKey:string;receipt:any;session:ClientSession}):Promise<void>;adapterId:string;providerId?:string;observe?(input:{command:EffectCommand;attempt:EffectAttempt;session?:ClientSession}):Promise<object|null>;stopProvider?(input:{tenantId:string;stopEpoch:number}):Promise<{state:string}>;verifyProviderBarrier?(input:{tenantId:string;stopEpoch:number;session?:ClientSession}):Promise<boolean>;statusAction?:string;readStatus?(input:{scope:VerifiedScope;grant:EffectGrant;command:EffectCommand;session:ClientSession}):Promise<void>;phases?(command:EffectCommand):string[];rebind?(input:{scope:VerifiedScope;command:EffectCommand;session:ClientSession}):Promise<EffectOrigin>;prepare?(input:EffectClaimPhase):Promise<Record<string,unknown>>;beforeInvoke?(input:{command:EffectCommand;attempt:EffectAttempt;session:ClientSession}):Promise<void>;invoke(input:EffectPhase):Promise<Record<string,unknown>>;publish(input:EffectPublicationPhase):Promise<Record<string,unknown>>;allowsChild?(input:{parent:EffectCommand;child:EffectCommand;phase:string;session:ClientSession}):Promise<boolean>;childEvents?:string[];authorizeChild?(input:{scope:VerifiedScope;command:EffectCommand;attempt:EffectAttempt;session:ClientSession}):Promise<EffectGrant>}
export interface ControlledEffectAdapter {readonly id:string;readonly mode:'LOCAL_SIMULATED';readonly instanceEpoch:string;invoke(attempt:EffectAttempt,work:()=>Promise<unknown>,options?:{authorize?(session:ClientSession):Promise<void>}):Promise<unknown>;observe(attempt:EffectAttempt,options?:{session?:ClientSession}):Promise<unknown>;reconcile(attempt:EffectAttempt,observation:object,options:{session:ClientSession}):Promise<unknown>;stopAndDrain(input:{tenantId:string;stopEpoch:number}):Promise<unknown>;verifyBarrier(input:{tenantId:string;stopEpoch:number;session?:ClientSession}):Promise<boolean>}
export interface SeparateEffects {
 initialize():Promise<void>;
 registerAdapter(adapter:ControlledEffectAdapter):void;
 registerKind(kind:string,handler:EffectHandler):void;
 supports(kind:string):boolean;
 hasAdapter(id:string):boolean;
 bind(commandId:string,origin:EffectOrigin):void;
 accept(input:{session:ClientSession;id?:string;grant:EffectGrant;actor:Record<string,unknown>;owner:EffectOwner;kind:string;plan:Record<string,unknown>;accepted:Record<string,unknown>;origin:EffectOrigin}):Promise<EffectCommand>;
 worker(capability:EffectWorkerCapability,input:{session:ClientSession;publish?:boolean}):Promise<{command:EffectCommand;attempt:EffectAttempt;ref:Record<string,unknown>}>;
 claim(commandId:string,phase?:string,parentCapability?:EffectWorkerCapability):Promise<{command:EffectCommand;attempt:EffectAttempt;claimed:boolean;capability:EffectWorkerCapability}>;
 reviewedRetry(input:{scope:VerifiedScope;grant:EffectGrant;commandId:string;phase:string;reviewKey:string;session:ClientSession}):Promise<unknown>;
 invoke(capability:EffectWorkerCapability):Promise<unknown>;
 settle(capability:EffectWorkerCapability):Promise<unknown>;
 run(commandId:string,phase?:string):Promise<unknown>;
 runChild(parentCapability:EffectWorkerCapability,commandId:string,phase:string,options?:{observeOnly?:boolean}):Promise<unknown>;
 observe(commandId:string,phase?:string):Promise<unknown>;
 continueChild(scope:VerifiedScope,parentId:string,commandId:string,phase:string):Promise<unknown>;
 rebind(scope:VerifiedScope,commandId:string):Promise<unknown>;
 status(scope:VerifiedScope,commandId:string):Promise<unknown>;
 childCapability(scope:VerifiedScope,commandId:string,phase:string,input:{session:ClientSession}):Promise<EffectWorkerCapability>;
 recordChild(capability:EffectWorkerCapability,input:{session:ClientSession;kind:string;proof:Record<string,unknown>}):Promise<unknown>;
 closeInSession(input:{tenantId:string;session:ClientSession}):Promise<unknown>;
 stopAndDrain(tenantId:string):Promise<unknown>;
 assertQuiescent(input:{tenantId:string;session:ClientSession}):Promise<void>;
 openInSession(input:{tenantId:string;session:ClientSession}):Promise<void>;
 managed(namespace:string,identity:Record<string,unknown>,input:{session:ClientSession}):Promise<EffectCommand|null>;
 verifyManagedRecord(input:{tenantId:string;commandId:string;reference:{key:string;id:string};session:ClientSession}):Promise<EffectCommand>;
 quiescence(input:{tenantId:string;session:ClientSession}):Promise<unknown>;
}
export declare function createSeparateEffects(input:{client:MongoClient;db:Db;foundation:TenantFoundation;admission?:unknown;clock?:()=>Date;fault?:(boundary:string,value:unknown)=>Promise<void>}):SeparateEffects;
export declare function effectHash(value:unknown):string;
export declare function effectTransaction<T>(client:MongoClient,effect:(session:ClientSession)=>Promise<T>):Promise<T>;
