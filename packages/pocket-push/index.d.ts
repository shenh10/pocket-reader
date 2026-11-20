export declare const PocketPush: {
  status():Promise<{configured:boolean;enabled:boolean;permission:boolean}>;
  register():Promise<{provider:'jpush'|'apns';token:string;environment:'production'|'development'}>;
  unregister():Promise<void>;
  pendingNotification():Promise<{date?:string}>;
};
