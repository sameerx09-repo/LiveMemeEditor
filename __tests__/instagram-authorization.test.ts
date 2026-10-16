import { discoverInstagramAccount,exchangeCodeForToken } from "@/lib/instagram";
import { parseInstagramJson } from "@/lib/instagram-json";

const originalFetch=global.fetch;
const env={...process.env};
const fetchMock=jest.fn();
const response=(body:unknown,ok=true)=>({ok,status:ok?200:400,json:async()=>body,text:async()=>JSON.stringify(body)});
beforeEach(()=>{
 jest.resetAllMocks();global.fetch=fetchMock;
 process.env.INSTAGRAM_AUTH_MODE="instagram";
 process.env.INSTAGRAM_APP_ID="fixture-app";
 process.env.INSTAGRAM_APP_SECRET="fixture-secret";
});
afterEach(()=>{global.fetch=originalFetch;process.env= {...env};});

test("numeric IDs are preserved exactly from Meta JSON",()=>{
 expect(parseInstagramJson('{"user_id":17841400000000001,"id":123,"code":100}'))
  .toEqual({user_id:"17841400000000001",id:"123",code:100});
});

test("the token exchange keeps the authorized ID with a long-lived token",async()=>{
 fetchMock.mockResolvedValueOnce({ok:true,text:async()=>'{"access_token":"short-fixture","user_id":17841400000000001}'})
  .mockResolvedValueOnce(response({access_token:"long-fixture"}));
 expect(await exchangeCodeForToken("fixture-code","https://editor.test/api/instagram/callback"))
  .toEqual({accessToken:"long-fixture",igUserId:"17841400000000001"});
 expect(fetchMock.mock.calls[0][1].method).toBe("POST");
});

test("single wrapped authorization responses retain their account identity",async()=>{
 fetchMock.mockResolvedValueOnce(response({data:[{access_token:"short-fixture",user_id:"123456789"}]}))
  .mockResolvedValueOnce(response({access_token:"long-fixture"}));
 expect(await exchangeCodeForToken("code","https://editor.test/callback"))
  .toEqual({accessToken:"long-fixture",igUserId:"123456789"});
});

test("short-lived fallback also retains the authorized ID",async()=>{
 fetchMock.mockResolvedValueOnce(response({access_token:"short-fixture",user_id:"123456789"}))
  .mockResolvedValueOnce(response({error:{message:"Unavailable"}},false));
 expect(await exchangeCodeForToken("code","https://editor.test/callback"))
  .toEqual({accessToken:"short-fixture",igUserId:"123456789"});
});

test.each([
 {access_token:"fixture"},
 {access_token:"fixture",user_id:"../me"},
 {data:[{access_token:"one",user_id:"123"},{access_token:"two",user_id:"456"}]},
 {access_token:"one",user_id:"123",data:[{access_token:"two",user_id:"456"}]},
])("invalid or ambiguous authorization does not guess an account",async payload=>{
 fetchMock.mockResolvedValueOnce(response(payload));
 await expect(exchangeCodeForToken("code","https://editor.test/callback")).rejects.toThrow();
 expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("profile lookup uses the token's account ID, not me, and saves the professional ID",async()=>{
 fetchMock.mockResolvedValueOnce(response({user_id:"17841400000000001",username:"second_account"}));
 expect(await discoverInstagramAccount("fixture-token","123456789"))
  .toEqual({igUserId:"17841400000000001",username:"second_account"});
 const url=new URL(fetchMock.mock.calls[0][0]);
 expect(url.hostname).toBe("graph.instagram.com");expect(url.pathname).toMatch(/\/123456789$/);
 expect(url.searchParams.get("fields")).toBe("user_id,username");
});

test.each([undefined,"../me",""])("missing or invalid account identity does not contact Meta",async id=>{
 await expect(discoverInstagramAccount("fixture",id)).rejects.toThrow("account ID");
 expect(fetchMock).not.toHaveBeenCalled();
});

test("lookup rejection does not invent a connected profile",async()=>{
 const log=jest.spyOn(console,"error").mockImplementation(()=>{});
 try{
  fetchMock.mockResolvedValueOnce(response({error:{message:"Unsupported request - method type: get",code:100}},false));
  await expect(discoverInstagramAccount("private-fixture","123")).rejects.toThrow("Unsupported request");
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-fixture");
 }finally{log.mockRestore();}
});

test("Facebook mode still discovers the linked page using its existing API",async()=>{
 process.env.INSTAGRAM_AUTH_MODE="facebook";
 fetchMock.mockResolvedValueOnce(response({data:[{id:"page",instagram_business_account:{id:"professional",username:"facebook_linked"}}]}));
 expect(await discoverInstagramAccount("fixture")).toEqual({pageId:"page",igUserId:"professional",username:"facebook_linked"});
 expect(new URL(fetchMock.mock.calls[0][0]).pathname).toMatch(/\/me\/accounts$/);
});
