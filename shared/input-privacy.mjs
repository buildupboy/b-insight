// Never return matched text: callers may show only this fixed message.
export const privacyMessage = '개인정보 또는 민감정보가 포함된 것으로 보여 분석을 중단했어요. 이름·연락처·상세 주소·금융정보·건강정보 등을 지우고 업종과 희망 지역만 입력해 주세요.';

const patterns = [
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+\s*@\s*[a-z0-9-]+(?:\s*\.\s*[a-z0-9-]+)+/i,
  /(?:\+?82[\s().-]*(?:0[\s().-]*)?|0)(?:1[016789]|2|[3-6][1-5]|70)[\s().-]*\d{3,4}[\s().-]*\d{4}(?!\d)/,
  /\b\d{6}[\s-]*[1-8]\d{6}\b/,
  // Conservatively block long identifiers including accounts and card numbers.
  /(?:^|[^\d])\d(?:[\s-]*\d){9,18}(?!\d)/,
  /(?:비밀\s*번호|패스워드|password|api[\s_-]*key|인증\s*번호|계좌\s*번호|카드\s*번호|주민\s*(?:등록\s*)?번호|여권\s*번호)\s*(?:는|은|이|가|:|=)?\s*\S+/i,
  /(?:제\s*이름은|내\s*이름은|성명\s*[:=]|이름\s*[:=])\s*\S+/,
  /[가-힣]+(?:대로|로|길)\s*\d+(?:-\d+)?/,
  /[가-힣]+(?:동|리)\s*\d+(?:-\d+)?\s*(?:번지|호|아파트)/,
  /(?:진단\s*받|병력\s*[:은는]|복용\s*중|주민등록증|운전면허증|성적\s*지향|정치\s*성향)/,
  /\bsk-(?:proj-)?[a-z0-9_-]{12,}\b/i,
];

export function hasSensitiveInput(value) {
  if (typeof value === 'string') {
    const normalized = value.normalize('NFKC').replace(/[\u200B-\u200F\u2060\uFEFF]/g, '');
    return patterns.some(pattern => pattern.test(normalized));
  }
  if (Array.isArray(value)) return value.some(hasSensitiveInput);
  if (value && typeof value === 'object') return Object.values(value).some(hasSensitiveInput);
  return false;
}
