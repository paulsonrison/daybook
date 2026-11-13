import type { RequestContext } from '../context.js';
import {
  savePayRule,
  payrollRecords,
  recordPayrollAdjustment,
  type PayrollAdjustmentInput,
  endPayRule,
  recordAttendance,
  recordStaffFunds,
  payrollPreview,
  postPayslip,
  payslips,
  recordPayrollPayout,
  type PayRuleInput,
  type AttendanceInput,
  type StaffFundsInput,
  type PayslipInput,
  type PayoutInput,
} from './service.js';
export const payrollTypeDefs = `
type PayrollRecord {id:ID!}
type PayrollPreview {staffId:ID!,month:String!,fingerprint:String!,salary:String!,adjustment:String!,commission:String!,routeAllowance:String!,advance:String!,reimbursement:String!,net:String!,missingDays:Int!,missingPreparedDays:Int!}
type PayRuleRecord {id:ID!,startDate:String!,endDate:String,employmentStart:String!,employmentEnd:String,mode:String!,monthlySalary:String!,copyRate:String!,routeAllowance:String!,proration:String!}
type AttendanceRecord {id:ID!,date:String!,status:String!,note:String!}
type StaffFundRecord {id:ID!,date:String!,kind:String!,amount:String!,remaining:String!,method:String!,evidence:String!}
type PayrollAdjustment {id:ID!,date:String!,amount:String!,reason:String!}
type PayrollRecords {rules:[PayRuleRecord!]!,attendance:[AttendanceRecord!]!,funds:[StaffFundRecord!]!,adjustments:[PayrollAdjustment!]!}
input PayrollAdjustmentInput {requestId:ID!,staffId:ID!,direction:String!,amount:String!,reason:String!}
type Payslip {id:ID!,code:String!,staffId:ID!,month:String!,net:String!,paid:Boolean!,snapshot:String!}
input PayRuleInput {requestId:ID!,staffId:ID!,startDate:String!,endDate:String,employmentStart:String!,employmentEnd:String,mode:String!,monthlySalary:String!,copyRate:String!,routeAllowance:String!,proration:String!}
input EndPayRuleInput {requestId:ID!,ruleId:ID!,endDate:String!,reason:String!,endEmployment:Boolean}
input AttendanceInput {requestId:ID!,staffId:ID!,date:String!,status:String!,note:String!}
input StaffFundsInput {requestId:ID!,staffId:ID!,date:String!,kind:String!,amount:String!,method:String!,reference:String,confirmReceived:Boolean!,approveExpense:Boolean,evidence:String!}
input PayslipInput {requestId:ID!,staffId:ID!,month:String!,fingerprint:String!,acknowledgeMissing:Boolean!}
input PayrollPayoutInput {requestId:ID!,payslipId:ID!,method:String!,reference:String,confirmReceived:Boolean!,evidence:String!}
extend type Query {payrollRecords(staffId:ID!):PayrollRecords!,payrollPreview(staffId:ID!,month:String!):PayrollPreview!,payslips(staffId:ID!):[Payslip!]!}
extend type Mutation {recordPayrollAdjustment(input:PayrollAdjustmentInput!):PayrollRecord!,endPayRule(input:EndPayRuleInput!):PayrollRecord!,savePayRule(input:PayRuleInput!):PayrollRecord!,recordAttendance(input:AttendanceInput!):PayrollRecord!,recordStaffFunds(input:StaffFundsInput!):PayrollRecord!,postPayslip(input:PayslipInput!):Payslip!,recordPayrollPayout(input:PayrollPayoutInput!):PayrollRecord!}
`;
export const payrollResolvers = {
  Query: {
    payrollRecords: (_r: unknown, a: { staffId: string }, c: RequestContext) =>
      payrollRecords(c, a.staffId),
    payrollPreview: (
      _r: unknown,
      a: { staffId: string; month: string },
      c: RequestContext,
    ) => payrollPreview(c, a.staffId, a.month),
    payslips: (_r: unknown, a: { staffId: string }, c: RequestContext) =>
      payslips(c, a.staffId),
  },
  Mutation: {
    recordPayrollAdjustment: (
      _r: unknown,
      a: { input: PayrollAdjustmentInput },
      c: RequestContext,
    ) => recordPayrollAdjustment(c, a.input),
    endPayRule: (
      _r: unknown,
      a: {
        input: {
          requestId: string;
          ruleId: string;
          endDate: string;
          endEmployment?: boolean;
          reason: string;
        };
      },
      c: RequestContext,
    ) => endPayRule(c, a.input),
    savePayRule: (_r: unknown, a: { input: PayRuleInput }, c: RequestContext) =>
      savePayRule(c, a.input),
    recordAttendance: (
      _r: unknown,
      a: { input: AttendanceInput },
      c: RequestContext,
    ) => recordAttendance(c, a.input),
    recordStaffFunds: (
      _r: unknown,
      a: { input: StaffFundsInput },
      c: RequestContext,
    ) => recordStaffFunds(c, a.input),
    postPayslip: (_r: unknown, a: { input: PayslipInput }, c: RequestContext) =>
      postPayslip(c, a.input),
    recordPayrollPayout: (
      _r: unknown,
      a: { input: PayoutInput },
      c: RequestContext,
    ) => recordPayrollPayout(c, a.input),
  },
};
