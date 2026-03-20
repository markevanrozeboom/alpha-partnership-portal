"""Pydantic models for the shared context store and all agent outputs."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class TargetType(str, Enum):
    SOVEREIGN_NATION = "sovereign_nation"
    US_STATE = "us_state"


# TierClassification REMOVED — workshop decision March 16, 2026
# All countries use unified model. No tiers.


class EntryMode(str, Enum):
    PRIVATE = "private"
    GOVERNMENT = "government"
    HYBRID = "hybrid"
    OPERATOR_LICENSOR = "operator_licensor"  # Default: Marriott model (100/0)


class PartnershipType(str, Enum):
    OPERATOR_LICENSOR = "operator_licensor"  # Default: Alpha operates, counterparty owns 100%
    JV = "jv"                                # Legacy — kept for US state compatibility
    LICENSING = "licensing"
    DIRECT = "direct"


class AudienceType(str, Enum):
    ROYAL = "royal"
    MINISTER = "minister"
    INVESTOR = "investor"


class PipelineStatus(str, Enum):
    PENDING = "pending"
    RESEARCHING_COUNTRY = "researching_country"
    REVIEW_COUNTRY_REPORT = "review_country_report"
    RESEARCHING_EDUCATION = "researching_education"
    REVIEW_EDUCATION_REPORT = "review_education_report"
    STRATEGIZING = "strategizing"
    REVIEW_STRATEGY = "review_strategy"
    PRESENTING_ASSUMPTIONS = "presenting_assumptions"
    REVIEW_ASSUMPTIONS = "review_assumptions"
    BUILDING_MODEL = "building_model"
    REVIEW_MODEL = "review_model"
    PRESENTING_TERM_SHEET_ASSUMPTIONS = "presenting_term_sheet_assumptions"
    REVIEW_TERM_SHEET_ASSUMPTIONS = "review_term_sheet_assumptions"
    GENERATING_DOCUMENTS = "generating_documents"
    REVIEW_DOCUMENTS = "review_documents"
    COMPLETED = "completed"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Country Profile (structured data)
# ---------------------------------------------------------------------------

class TargetInfo(BaseModel):
    name: str = ""
    type: TargetType = TargetType.SOVEREIGN_NATION
    region: str = ""
    # tier field REMOVED — unified model, no tiers (workshop March 16, 2026)


class Demographics(BaseModel):
    total_population: Optional[float] = None
    population_0_18: Optional[float] = None
    growth_rate: Optional[float] = None
    urbanisation: Optional[float] = None
    median_age: Optional[float] = None
    median_household_income: Optional[float] = None
    gini_coefficient: Optional[float] = None
    top_10_pct_income: Optional[float] = None
    middle_class_income_range: Optional[str] = None


class Economy(BaseModel):
    gdp: Optional[float] = None
    gdp_per_capita: Optional[float] = None
    gdp_growth_rate: Optional[float] = None
    currency: Optional[str] = None
    fx_rate: Optional[float] = None
    inflation: Optional[float] = None
    sovereign_wealth_fund: Optional[str] = None
    swf_aum: Optional[float] = None
    credit_rating: Optional[str] = None


class EducationData(BaseModel):
    k12_enrolled: Optional[float] = None
    public_private_split: Optional[str] = None
    avg_public_spend_per_student: Optional[float] = None
    avg_private_tuition: Optional[float] = None
    premium_private_tuition_range: Optional[str] = None
    teacher_count: Optional[float] = None
    student_teacher_ratio: Optional[float] = None
    pisa_scores: Optional[str] = None
    literacy_rate: Optional[float] = None
    net_enrollment_rate: Optional[float] = None
    dropout_rate: Optional[float] = None
    education_budget_pct_gdp: Optional[float] = None
    language_of_instruction: Optional[str] = None
    national_curriculum_requirements: Optional[str] = None
    mandatory_subjects: Optional[str] = None


class Regulatory(BaseModel):
    ministry_of_education: Optional[str] = None
    key_regulators: Optional[str] = None
    private_school_licensing_process: Optional[str] = None
    licensing_timeline: Optional[str] = None
    foreign_ownership_rules: Optional[str] = None
    foreign_ownership_cap: Optional[str] = None
    charter_school_equivalents: Optional[str] = None
    ppp_framework: Optional[str] = None
    curriculum_flexibility: Optional[str] = None


class PoliticalContext(BaseModel):
    government_type: Optional[str] = None
    head_of_state: Optional[str] = None
    key_education_decision_maker: Optional[str] = None
    national_vision_plan: Optional[str] = None
    education_reform_priority: Optional[str] = None
    reform_themes: Optional[str] = None
    geopolitical_risk: Optional[str] = None
    corruption_index: Optional[float] = None


class Competitor(BaseModel):
    name: str = ""
    students: Optional[str] = None
    tuition_range: Optional[str] = None


class CompetitiveLandscape(BaseModel):
    major_operators: list[Competitor] = Field(default_factory=list)
    international_chains: Optional[str] = None
    edtech_penetration: Optional[str] = None
    market_gaps: Optional[str] = None


class USStateESA(BaseModel):
    esa_amount: Optional[str] = None
    students_on_vouchers: Optional[str] = None
    avg_private_tuition: Optional[float] = None
    esa_coverage_pct: Optional[str] = None
    eligibility: Optional[str] = None
    program_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Flagship Market Data (metro-level inputs for grid search)
# ---------------------------------------------------------------------------

class MetroFlagshipInput(BaseModel):
    """Metro-level data for flagship school sizing per financial_rules_v1.md."""
    metro_name: str = ""
    is_capital: bool = False
    metro_population: int = 0
    k12_children: int = 0
    # Wealth thresholds: K-12 children in families with income ≥ threshold
    children_in_families_income_above_200k: int = 0  # AGI ≥ $200K (5× $40K)
    children_in_families_income_above_500k: int = 0  # AGI ≥ $500K (5× $100K)
    most_expensive_nonboarding_tuition: float = 0
    most_expensive_nonboarding_school: str = ""


class FlagshipMarketData(BaseModel):
    """Country-level flagship market data from research."""
    metros: list[MetroFlagshipInput] = Field(default_factory=list)
    country_most_expensive_nonboarding_tuition: float = 0
    country_most_expensive_nonboarding_school: str = ""


class CountryProfile(BaseModel):
    target: TargetInfo = Field(default_factory=TargetInfo)
    demographics: Demographics = Field(default_factory=Demographics)
    economy: Economy = Field(default_factory=Economy)
    education: EducationData = Field(default_factory=EducationData)
    regulatory: Regulatory = Field(default_factory=Regulatory)
    political_context: PoliticalContext = Field(default_factory=PoliticalContext)
    competitive_landscape: CompetitiveLandscape = Field(default_factory=CompetitiveLandscape)
    us_state_esa: Optional[USStateESA] = None
    flagship_market_data: Optional[FlagshipMarketData] = None
    research_sources: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Education Analysis (structured data)
# ---------------------------------------------------------------------------

class SystemDiagnosis(BaseModel):
    primary_pain_points: list[str] = Field(default_factory=list)
    parent_pain_points: list[str] = Field(default_factory=list)
    government_pain_points: list[str] = Field(default_factory=list)


class ReformLandscape(BaseModel):
    active_reforms: list[str] = Field(default_factory=list)
    reform_budget: Optional[str] = None
    appetite_for_foreign_models: Optional[str] = None
    prior_edtech_initiatives: list[str] = Field(default_factory=list)
    failed_reforms: list[str] = Field(default_factory=list)


class TwoHrLearningFit(BaseModel):
    unique_value_propositions: list[str] = Field(default_factory=list)
    localization_requirements: list[str] = Field(default_factory=list)
    model_recommendation: Optional[EntryMode] = None
    rationale: Optional[str] = None


class EducationAnalysis(BaseModel):
    system_diagnosis: SystemDiagnosis = Field(default_factory=SystemDiagnosis)
    reform_landscape: ReformLandscape = Field(default_factory=ReformLandscape)
    two_hr_learning_fit: TwoHrLearningFit = Field(default_factory=TwoHrLearningFit)


# ---------------------------------------------------------------------------
# Strategy (structured data)
# ---------------------------------------------------------------------------

class PartnershipStructure(BaseModel):
    type: Optional[PartnershipType] = None
    local_partner_description: Optional[str] = None
    ownership_split: Optional[str] = None
    ip_structure: Optional[str] = None


class Brand(BaseModel):
    jv_name_suggestion: Optional[str] = None
    positioning: Optional[str] = None
    tagline: Optional[str] = None


class SchoolTypeDeployment(BaseModel):
    name: str = ""
    focus: Optional[str] = None
    target_market: Optional[str] = None
    size: Optional[str] = None
    tuition: Optional[str] = None


class PhaseRollout(BaseModel):
    phase: str = ""
    timeline: str = ""
    student_count: Optional[int] = None
    milestones: list[str] = Field(default_factory=list)


class ValueProposition(BaseModel):
    pillar: str = ""
    proof_points: list[str] = Field(default_factory=list)


class Strategy(BaseModel):
    entry_mode: Optional[EntryMode] = None
    partnership_structure: PartnershipStructure = Field(default_factory=PartnershipStructure)
    brand: Brand = Field(default_factory=Brand)
    school_types: list[SchoolTypeDeployment] = Field(default_factory=list)
    phased_rollout: list[PhaseRollout] = Field(default_factory=list)
    value_propositions: list[ValueProposition] = Field(default_factory=list)
    pitch_angle: Optional[str] = None
    key_asks: list[str] = Field(default_factory=list)
    target_student_count_year5: Optional[int] = None
    per_student_budget: Optional[float] = None
    upfront_ask: Optional[float] = None


# ---------------------------------------------------------------------------
# Financial Assumptions (user-configurable)
# ---------------------------------------------------------------------------

class FinancialAssumption(BaseModel):
    """A single configurable assumption with slider metadata."""
    key: str
    label: str
    value: float
    min_val: float
    max_val: float
    step: float
    unit: str = ""            # "$", "%", "x", "students", "years"
    category: str = "general"  # pricing, scale, costs, fees, returns
    description: str = ""
    locked: bool = False      # True = non-negotiable (fee floors etc.)


class FinancialAssumptions(BaseModel):
    """All assumptions for the financial model, grouped by category."""
    assumptions: list[FinancialAssumption] = Field(default_factory=list)
    # Carries the flagship optimization result through to model builder
    flagship_optimization: Optional["FlagshipOptimizationResult"] = None


# ---------------------------------------------------------------------------
# Financial Model (output)
# ---------------------------------------------------------------------------

class YearProjection(BaseModel):
    year: int = 0
    students: int = 0
    schools: int = 0
    revenue: float = 0
    cogs: float = 0
    gross_margin: float = 0
    opex: float = 0
    ebitda: float = 0
    net_income: float = 0
    free_cash_flow: float = 0
    cumulative_cash: float = 0


class UnitEconomics(BaseModel):
    school_type: str = ""
    per_student_revenue: float = 0
    per_student_cost: float = 0
    contribution_margin: float = 0
    margin_pct: float = 0


class CapitalDeployment(BaseModel):
    year: int = 0
    ip_development: float = 0
    management_fees: float = 0
    launch_capital: float = 0
    real_estate: float = 0
    total: float = 0


class ReturnsAnalysis(BaseModel):
    irr: Optional[float] = None
    moic: Optional[float] = None
    enterprise_value_at_exit: Optional[float] = None
    payback_period_years: Optional[float] = None
    ebitda_multiple: Optional[float] = None


class SensitivityScenario(BaseModel):
    variable: str = ""
    base_case: float = 0
    downside: float = 0
    upside: float = 0


class FlagshipMetroResult(BaseModel):
    """Optimized flagship result for a single metro."""
    metro_name: str = ""
    is_capital: bool = False
    schools: int = 0
    capacity_per_school: int = 0
    tuition: float = 0
    annual_revenue: float = 0
    eligible_children: int = 0
    demand_at_penetration: int = 0


class FlagshipOptimizationResult(BaseModel):
    """Complete flagship optimization result across all metros."""
    metros: list[FlagshipMetroResult] = Field(default_factory=list)
    total_schools: int = 0
    total_students: int = 0
    optimal_tuition: float = 0
    optimal_capacity: int = 0
    total_annual_revenue: float = 0
    tuition_exceeds_most_expensive: bool = True
    most_expensive_school_name: str = ""
    most_expensive_school_tuition: float = 0
    # If no metros qualify, note scholarship requirements
    scholarship_needed: bool = False
    scholarship_note: str = ""


class FinancialModel(BaseModel):
    pnl_projection: list[YearProjection] = Field(default_factory=list)
    unit_economics: list[UnitEconomics] = Field(default_factory=list)
    capital_deployment: list[CapitalDeployment] = Field(default_factory=list)
    returns_analysis: ReturnsAnalysis = Field(default_factory=ReturnsAnalysis)
    sensitivity: list[SensitivityScenario] = Field(default_factory=list)
    # Fixed model parameters (no PPP, no tiers — workshop March 16, 2026)
    management_fee_pct: float = 0.10
    timeback_license_pct: float = 0.20
    # Upfront fees — FIXED (not country-scaled)
    upfront_ip_fee: float = 25_000_000
    upfront_alphacore_license: float = 250_000_000
    upfront_incept_edllm: float = 250_000_000
    upfront_app_content_rd: float = 250_000_000
    upfront_lifeskills_rd: float = 250_000_000
    upfront_mgmt_fee: float = 0       # Operating Fee prepaid
    upfront_timeback_fee: float = 0    # Timeback prepaid
    total_management_fee_revenue: float = 0
    total_timeback_license_revenue: float = 0
    # Two-prong model — Flagship (Prong 1)
    flagship_tuition: float = 0
    flagship_students: int = 0
    flagship_revenue: float = 0
    flagship_optimization: Optional[FlagshipOptimizationResult] = None
    # Two-prong model — National (Prong 2)
    national_per_student_budget: float = 25_000
    national_students: int = 0
    national_revenue: float = 0


# ---------------------------------------------------------------------------
# HITL Decision Gate models
# ---------------------------------------------------------------------------

class ReportFeedback(BaseModel):
    """User feedback on a research/strategy report."""
    approved: bool = False
    feedback: Optional[str] = None  # specific feedback / revision requests
    entry_mode: Optional[EntryMode] = None  # only for country report gate


class AssumptionsFeedback(BaseModel):
    """User-adjusted assumptions from the interactive editor."""
    approved: bool = False
    adjustments: dict[str, float] = Field(default_factory=dict)  # key → new value
    notes: Optional[str] = None


class ModelFeedback(BaseModel):
    """User review of financial model — lock or adjust."""
    locked: bool = False
    adjustments: dict[str, float] = Field(default_factory=dict)
    notes: Optional[str] = None


class TermSheetAssumptionsFeedback(BaseModel):
    """User-adjusted term sheet assumptions from the interactive editor."""
    approved: bool = False
    adjustments: dict[str, float] = Field(default_factory=dict)
    notes: Optional[str] = None


class DocumentFeedback(BaseModel):
    """Final review of generated documents."""
    approved: bool = False
    audience: AudienceType = AudienceType.INVESTOR
    revision_notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Pipeline State
# ---------------------------------------------------------------------------

class PipelineState(BaseModel):
    """Full shared context store used by all agents."""
    run_id: str = ""
    target_input: str = ""
    status: PipelineStatus = PipelineStatus.PENDING

    # Agent outputs — structured data
    country_profile: CountryProfile = Field(default_factory=CountryProfile)
    education_analysis: EducationAnalysis = Field(default_factory=EducationAnalysis)
    strategy: Strategy = Field(default_factory=Strategy)
    financial_assumptions: FinancialAssumptions = Field(default_factory=FinancialAssumptions)
    financial_model: FinancialModel = Field(default_factory=FinancialModel)

    # Agent outputs — narrative reports (markdown)
    country_report: str = ""
    education_report: str = ""
    strategy_report: str = ""

    # Term sheet assumptions
    term_sheet_assumptions: FinancialAssumptions = Field(default_factory=FinancialAssumptions)

    # HITL decisions
    country_report_feedback: Optional[ReportFeedback] = None
    education_report_feedback: Optional[ReportFeedback] = None
    strategy_feedback: Optional[ReportFeedback] = None
    assumptions_feedback: Optional[AssumptionsFeedback] = None
    model_feedback: Optional[ModelFeedback] = None
    term_sheet_assumptions_feedback: Optional[TermSheetAssumptionsFeedback] = None
    document_feedback: Optional[DocumentFeedback] = None

    # Output file paths
    pptx_path: Optional[str] = None
    docx_path: Optional[str] = None
    xlsx_path: Optional[str] = None
    term_sheet_docx_path: Optional[str] = None
    country_report_docx_path: Optional[str] = None
    education_report_docx_path: Optional[str] = None
    strategy_report_docx_path: Optional[str] = None

    # Error tracking
    error_message: Optional[str] = None
    agent_logs: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# API Request/Response models
# ---------------------------------------------------------------------------

class CreateRunRequest(BaseModel):
    target: str = Field(..., description="Country name or US state name")


class RunStatusResponse(BaseModel):
    run_id: str
    status: PipelineStatus
    target: str
    # tier field REMOVED — unified model, no tiers
    target_type: Optional[str] = None
    agent_logs: list[str] = Field(default_factory=list)

    # Structured data
    country_profile: Optional[CountryProfile] = None
    education_analysis: Optional[EducationAnalysis] = None
    strategy: Optional[Strategy] = None
    financial_assumptions: Optional[FinancialAssumptions] = None
    financial_model: Optional[FinancialModel] = None

    # Term sheet assumptions
    term_sheet_assumptions: Optional[FinancialAssumptions] = None

    # Narrative reports (markdown)
    country_report: Optional[str] = None
    education_report: Optional[str] = None
    strategy_report: Optional[str] = None

    # Gamma slide deck URLs
    gamma_url: Optional[str] = None
    gamma_export_url: Optional[str] = None

    # File paths
    pptx_path: Optional[str] = None
    docx_path: Optional[str] = None
    xlsx_path: Optional[str] = None
    term_sheet_docx_path: Optional[str] = None
    country_report_docx_path: Optional[str] = None
    education_report_docx_path: Optional[str] = None
    strategy_report_docx_path: Optional[str] = None

    error_message: Optional[str] = None


class RecalculateRequest(BaseModel):
    """Request to recalculate financial model with adjusted assumptions."""
    adjustments: dict[str, float] = Field(default_factory=dict)


class RewindRequest(BaseModel):
    """Request to rewind the pipeline to an earlier review gate for re-editing."""
    target_stage: str = Field(
        ...,
        description="The review gate to rewind to: 'review_assumptions' or 'review_term_sheet_assumptions'",
    )
