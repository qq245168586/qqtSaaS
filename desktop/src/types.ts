export type CompanyId = 'tri' | 'tmy';

export interface CompanyProfile {
  id: CompanyId;
  shortName: string;
  name: string;
  printName: string;
  address: string;
  phone: string;
  accent: string;
  productHeader: '产品名称 / 规格' | '品 名 / 规 格';
}

export interface DeliveryItem {
  id: string;
  orderNumber?: string;
  name: string;
  specification?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  remark?: string;
}

export interface DeliveryNote {
  id: string;
  companyId: CompanyId;
  number: string;
  sourceNumber?: string;
  createdAt?: string;
  printedAt?: string;
  date: string;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  page: number;
  totalPages: number;
  items: DeliveryItem[];
  maker: string;
  keeper: string;
  salesperson: string;
  deliveryPerson: string;
}

export interface Customer {
  id: string;
  companyId: CompanyId;
  code?: string;
  name: string;
  address?: string;
  contact?: string;
  phone?: string;
  category?: string;
  active: boolean;
}

export interface CustomerCategory {
  id: string;
  companyId: CompanyId;
  name: string;
  customerCount?: number;
  active: boolean;
}

export type PersonnelRole = 'maker' | 'keeper' | 'salesperson' | 'deliveryPerson';

export interface PersonnelRecord {
  id: string;
  companyId: CompanyId;
  name: string;
  lastUsedAt?: string;
  active: boolean;
}

export interface Product {
  id: string;
  companyId: CompanyId;
  name: string;
  specification?: string;
  unit: string;
  defaultPrice: number;
  active: boolean;
}

export const companies: Record<CompanyId, CompanyProfile> = {
  tri: {
    id: 'tri',
    shortName: '趣趣特 TRI',
    name: '深圳市趣趣特餐饮管理有限公司',
    printName: '深圳市趣趣特餐饮管理有限公司',
    address: '南头街道马家龙社区大新路88号63栋802-22',
    phone: '13590330177',
    accent: '#e23b36',
    productHeader: '产品名称 / 规格',
  },
  tmy: {
    id: 'tmy',
    shortName: '天美意 TMY',
    name: '深圳市天美意餐饮管理有限公司',
    printName: '深圳市天美意餐饮管理有限公司',
    address: '南头街道马家龙社区大新路88号63栋202-11',
    phone: '13590330177',
    accent: '#73bc45',
    productHeader: '品 名 / 规 格',
  },
};
