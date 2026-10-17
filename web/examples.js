// Made-up chats for the empty state (all but the first are also in test/fixtures/chats.json).
// No real messages. The first one walks through a whole small fight, one card per turn.
export const EXAMPLES = [
  { id: "forgot-what-i-said", zh: "你是不是又忘了", en: "Did you forget again?", stage: "dating", thread: [
    { from: "partner", text: "你是不是又把我说过的话忘了？" },
    { from: "me", text: "没忘，你先别提示，我自己想。" },
    { from: "partner", text: "那你说。" },
    { from: "me", text: "等我一下，我想说完整。" },
    { from: "partner", text: "你最好是。" },
    { from: "me", text: "想起来了：你说周末想去看海，而且不想每次都是你来订。" },
    { from: "partner", text: "所以呢？" },
    { from: "me", text: "所以这次我来订，车票和住的地方定好再告诉你。" },
    { from: "partner", text: "这还差不多。" } ] },
  { id: "forgot-date", zh: "忘了特别的日子", en: "A date I forgot", stage: "dating", thread: [
    { from: "partner", text: "今天是什么日子你记得吗" },
    { from: "me", text: "周二？怎么了" },
    { from: "partner", text: "呵呵，没事，你忙吧" } ] },
  { id: "bad-day", zh: "TA 今天很累", en: "Their rough day", stage: "partner", thread: [
    { from: "partner", text: "今天被领导当着全组的面骂了" },
    { from: "partner", text: "好累，不想说话" } ] },
  { id: "hotpot-plan", zh: "约周六火锅", en: "Saturday hotpot", stage: "dating", thread: [
    { from: "partner", text: "周六那家火锅你订了吗" },
    { from: "me", text: "还没，我现在订" },
    { from: "partner", text: "订晚上六点半的吧，人少一点" } ] },
  { id: "english-miss", zh: "英文：想你了", en: "Missing you", stage: "dating", thread: [
    { from: "partner", text: "I miss you so much today" },
    { from: "partner", text: "when are you coming back?" } ] },
];
