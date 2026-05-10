import type { UrbanDevelopmentLifecycleStage } from '../urban-development';
import type { UrbanDevelopmentSignalType } from '../urban-development';

/** Single thematic matcher for госзакупки-like subject lines (fixture or API payloads). */
export interface PublicProcurementUrbanKeywordRule {
  readonly needles: readonly string[];
  readonly signalType: UrbanDevelopmentSignalType;
  readonly lifecycleStage: UrbanDevelopmentLifecycleStage;
  /** Higher wins when multiple needles match; keep gaps between bands for future insertions. */
  readonly priority: number;
}

/**
 * Canonical procurement → urban signal thematic dictionary (RU).
 * Matching is substring-based on a normalized lowercase blob built from notice fields.
 */
export const PUBLIC_PROCUREMENT_URBAN_KEYWORD_RULES: readonly PublicProcurementUrbanKeywordRule[] = [
  {
    needles: ['инженерные изыскания', 'инженерных изысканий', 'инженерно-геологических', 'инженерно-геодезических'],
    signalType: 'engineering_survey',
    lifecycleStage: 'design',
    priority: 110,
  },
  {
    needles: ['проект планировки', 'проекта планировки', 'планировки территории'],
    signalType: 'planning_contract',
    lifecycleStage: 'planning',
    priority: 109,
  },
  {
    needles: ['проектной документации', 'проектная документация', 'разделы пд'],
    signalType: 'design_documentation',
    lifecycleStage: 'design',
    priority: 108,
  },
  {
    needles: ['транспортный узел', 'транспортного узла', 'мультимодальный транспортный узел', 'пересадочный узел'],
    signalType: 'transport_hub',
    lifecycleStage: 'design',
    priority: 107,
  },
  {
    needles: ['развязк'],
    signalType: 'road_project',
    lifecycleStage: 'design',
    priority: 106,
  },
  {
    needles: ['реконструкция дороги', 'реконструкцию дорог', 'реконструкция дорог'],
    signalType: 'road_project',
    lifecycleStage: 'procurement',
    priority: 105,
  },
  {
    needles: ['строительство дороги', 'строительство дорог', 'строительство автомобильной дороги', 'новое строительство автомобильной дороги'],
    signalType: 'road_project',
    lifecycleStage: 'procurement',
    priority: 104,
  },
  {
    needles: ['детский сад', 'детского сада', 'дошкольное образование'],
    signalType: 'social_infrastructure',
    lifecycleStage: 'procurement',
    priority: 103,
  },
  {
    needles: ['строительство школы', ' школы ', 'школы на', 'общеобразовательная школа'],
    signalType: 'social_infrastructure',
    lifecycleStage: 'procurement',
    priority: 103,
  },
  {
    needles: ['поликлиник', 'больниц'],
    signalType: 'social_infrastructure',
    lifecycleStage: 'procurement',
    priority: 102,
  },
  {
    needles: ['инженерных сетей', 'инженерные сети', 'наружные инженерные сети', 'инженерным сетям'],
    signalType: 'infrastructure_plan_doc',
    lifecycleStage: 'design',
    priority: 101,
  },
];

export interface PublicProcurementProcedureLifecycleRule {
  readonly needles: readonly string[];
  readonly lifecycleStage: UrbanDevelopmentLifecycleStage;
}

/** Procedure-stage hints (RU); evaluated before falling back to keyword defaults. */
export const PUBLIC_PROCUREMENT_PROCEDURE_LIFECYCLE_RULES: readonly PublicProcurementProcedureLifecycleRule[] = [
  {
    needles: ['исполнение контракта', 'подготовительный период', 'выполнение работ'],
    lifecycleStage: 'construction_preparation',
  },
  {
    needles: ['рабочее проектирование', 'разработка документации'],
    lifecycleStage: 'design',
  },
  {
    needles: ['подача заявок', 'электронный аукцион', 'открытый конкурс', 'запрос котировок', 'запрос предложений', 'определение подряд', 'определение подрядчик', 'определение поставщика', 'единственного поставщика'],
    lifecycleStage: 'procurement',
  },
];
