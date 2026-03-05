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


class TierClassification(int, Enum):
    TIER_1 = 1
    TIER_2 = 2
    TIER_3 = 3


class EntryMode(str, Enum):
    PRIVATE = "private"
    GOVERNMENT = "government"
    HYBRID = "hybrid"


class PartnershipType(str, Enum):
    JV = "jv"
    LICENSING = "licensing"
    FRANCHISE = "franchise"
    DIRECT = "direct"


class AudienceType(str, Enum):
    ROYAL = "royal"
    MINISTER = "minister"
    INVESTOR = "investor"


class PipelineStatus(str, Enum):
    PENDING = "pending"
    RESEARCHING = "researching"
    AWAITING_GATE_1 = "awaiting_gate_1"
    STRATEGIZING = "strategizing"
    AWAITING_GATE_2 = "awaiting_gate_2"
    GENERATING = "generating"
    AWAITING_GATE_3 = "awaiting_gate_3"
    COMPLETED = "completed"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Country Profile (Country Research Agent output)
# ---------------------------------------------------------------------------

class TargetInfo(BaseModel):
    name: str = ""
    type: TargetType = TargetType.SOVEREIGN_NATION
    region: str = ""
    tier: Optional[TierClassification] = None


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


class CountryProfile(BaseModel):
    target: TargetInfo = Field(default_factory=TargetInfo)
    demographics: Demographics = Field(default_factory=Demographics)
    economy: Economy = Field(default_factory=Economy)
    education: EducationData = Field(default_factory=EducationData)
    regulatory: Regulatory = Field(default_factory=Regulatory)
    political_context: PoliticalContext = Field(default_factory=PoliticalContext)
    competitive_landscape: CompetitiveLandscape = Field(default_factory=CompetitiveLandscape)
    us_state_esa: Optional[USStateESA] = None
    research_sources: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Education Analysis (Education Research Agent output)
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
    localisation_requirements: list[str] = Field(default_factory=list)
    model_recommendation: Optional[EntryMode] = None
    rationale: Optional[str] = None


class EducationAnalysis(BaseModel):
    system_diagnosis: SystemDiagnosis = Field(default_factory=SystemDiagnosis)
    reform_landscape: ReformLandscape = Field(default_factory=ReformLandscape)
    two_hr_learning_fit: TwoHrLearningFit = Field(default_factory=TwoHrLearningFit)


# ---------------------------------------------------------------------------
# Strategy (Strategy Agent output)
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
# Financial Model (Financial Modelling Agent output)
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


class FinancialModel(BaseModel):
    pnl_projection: list[YearProjection] = Field(default_factory=list)
    unit_economics: list[UnitEconomics] = Field(default_factory=list)
    capital_deployment: list[CapitalDeployment] = Field(default_factory=list)
    returns_analysis: ReturnsAnalysis = Field(default_factory=ReturnsAnalysis)
    sensitivity: list[SensitivityScenario] = Field(default_factory=list)

    # Scaling formula inputs
    ppp_factor: float = 1.0
    demand_factor: float = 1.0
    management_fee_pct: float = 0.10
    timeback_license_pct: float = 0.20
    upfront_ip_fee: float = 25_000_000
    total_management_fee_revenue: float = 0
    total_timeback_license_revenue: float = 0


# ---------------------------------------------------------------------------
# HITL Decision Gate models
# ---------------------------------------------------------------------------

class Gate1Decision(BaseModel):
    """User decision after research phase."""
    entry_mode: EntryMode = EntryMode.HYBRID
    notes: Optional[str] = None


class Gate2Decision(BaseModel):
    """User decision after strategy phase."""
    confirmed_student_count: Optional[int] = None
    confirmed_pricing: Optional[float] = None
    confirmed_school_types: Optional[list[str]] = None
    audience: AudienceType = AudienceType.INVESTOR
    notes: Optional[str] = None


class Gate3Decision(BaseModel):
    """User decision after output generation."""
    approved: bool = False
    revision_notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Pipeline State (shared context store for LangGraph)
# ---------------------------------------------------------------------------

class PipelineState(BaseModel):
    """Full shared context store used by all agents."""
    run_id: str = ""
    target_input: str = ""
    status: PipelineStatus = PipelineStatus.PENDING

    # Agent outputs
    country_profile: CountryProfile = Field(default_factory=CountryProfile)
    education_analysis: EducationAnalysis = Field(default_factory=EducationAnalysis)
    strategy: Strategy = Field(default_factory=Strategy)
    financial_model: FinancialModel = Field(default_factory=FinancialModel)

    # HITL decisions
    gate1_decision: Optional[Gate1Decision] = None
    gate2_decision: Optional[Gate2Decision] = None
    gate3_decision: Optional[Gate3Decision] = None

    # Output file paths
    pptx_path: Optional[str] = None
    docx_path: Optional[str] = None
    xlsx_path: Optional[str] = None

    # Error tracking
    error_message: Optional[str] = None
    agent_logs: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# API Request/Response models
# ---------------------------------------------------------------------------

class CreateRunRequest(BaseModel):
    target: str = Field(..., description="Country name or US state name")
    audience: Optional[AudienceType] = AudienceType.INVESTOR


class RunStatusResponse(BaseModel):
    run_id: str
    status: PipelineStatus
    target: str
    tier: Optional[int] = None
    target_type: Optional[str] = None
    agent_logs: list[str] = Field(default_factory=list)
    country_profile: Optional[CountryProfile] = None
    education_analysis: Optional[EducationAnalysis] = None
    strategy: Optional[Strategy] = None
    financial_model: Optional[FinancialModel] = None
    pptx_path: Optional[str] = None
    docx_path: Optional[str] = None
    xlsx_path: Optional[str] = None
    error_message: Optional[str] = None
