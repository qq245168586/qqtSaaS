export type BomParseFormValues = {
  company_code: 'tri' | 'tmy';
  source_text: string;
};

export type BomParseRequest = {
  company_code: 'tri' | 'tmy';
  text: string;
};

export function toBomParseRequest(values: BomParseFormValues): BomParseRequest {
  return {
    company_code: values.company_code,
    text: values.source_text,
  };
}
