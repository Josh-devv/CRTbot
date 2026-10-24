//+------------------------------------------------------------------+
//|                                      CRTbot_Exness_Sniper.mq5    |
//|                        CRTbot - Exness USTECm demo sniper EA     |
//|                                                                  |
//|  Log-only by default. Set InpTradingEnabled=true only after you  |
//|  have checked the level logs on the demo chart.                  |
//+------------------------------------------------------------------+
#property copyright "CRTbot"
#property version   "1.005"
#property description "ICT sniper EA for Exness USTECm demo. Log-only by default."
#property description "Uses prior RTH/week, Asian, London, opening-range levels."
#property description "ATR-scaled structural stop, nearest opposing liquidity target."

#include <Trade\Trade.mqh>

input group "=== Safety ==="
input bool   InpTradingEnabled        = false;      // false = log only, no orders
input bool   InpDemoOnly              = true;       // refuse real accounts
input int    InpMagic                 = 20261022;   // EA magic number
input int    InpSlippagePoints        = 20;         // MT5 points for market exits
input double InpMaxSpreadPricePoints  = 2.5;        // price points; skip if spread is wider
input int    InpServerGMTOffsetHours  = 999;        // 999 = auto from TimeTradeServer()-TimeGMT()

input group "=== Position sizing ==="
input double InpRiskPercentMin        = 1.0;        // low-tier risk % of equity
input double InpRiskPercentMax        = 5.0;        // absolute max risk % (A+ validated)
input double InpMaxLot                = 1.0;        // hard cap for risk-based lot sizing
input bool   InpSkipLowQuality       = false;      // skip score<=2 instead of risking 1%
input bool   InpAPlusValidated       = false;      // allow A+ above 3% only after validation

input group "=== Strategy ==="
input double InpAtrMultiplier         = 0.25;       // stop buffer = max(floor, mult * ATR)
input int    InpAtrPeriod             = 14;         // ATR period on M5
input double InpBufferFloor           = 2.0;        // minimum buffer in price points
input double InpLimitOffsetPoints     = 0.1;        // limit offset beyond level, price points
input bool   InpUseProvisionalStop    = true;       // temporary wide stop before entry bar closes
input double InpProvisionalStopAtrMult= 3.0;        // provisional stop distance in ATRs
input bool   InpUseDailyBias          = false;      // long only on bullish prior RTH, short only bearish
input bool   InpSkipMonday            = false;      // no new entries on Monday (NY)
input double InpMinRewardRisk         = 3.0;        // minimum target/risk; 0 = nearest target only
input bool   InpPreFilterMinRR        = true;       // skip limits with no estimated >=minRR target

input group "=== New York Times ==="
input int    InpLevelsHourNY          = 9;          // build levels at 09:25 NY
input int    InpLevelsMinNY           = 25;
input int    InpWindowStartHourNY     = 9;          // entry window 09:30-10:30 NY
input int    InpWindowStartMinNY      = 30;
input int    InpWindowEndHourNY       = 10;
input int    InpWindowEndMinNY        = 30;
input int    InpExitHourNY            = 12;         // flat at 12:00 NY
input int    InpExitMinNY             = 0;

#define MAX_LEVELS 24

struct SLevel
{
   string name;
   double price;
   bool   isHigh;    // true = sell limit above, false = buy limit below
   bool   entry;     // true = core entry level, false = target-only level
};

SLevel g_levels[MAX_LEVELS];
bool   g_levelOrdered[MAX_LEVELS];
bool   g_levelSkipLogged[MAX_LEVELS];
int    g_levelCount = 0;
int    g_coreCount  = 0;

CTrade g_trade;
int    g_atrHandle = INVALID_HANDLE;
double g_lot = 0.05;
double g_minLot = 0.01;
double g_maxLot = 1.0;
double g_lotStep = 0.01;
double g_tickSize = 0.0;
double g_tickValue = 0.0;
int    g_digits = 2;
double g_maxSpread = 2.5;
int    g_serverOffsetSeconds = 0;

int      g_dayKey = 0;
int      g_dailyBias = 0;          // +1 bullish, -1 bearish, 0 neutral/unknown
bool     g_mondayLogged = false;
bool     g_coreLevelsDone = false;
bool     g_openLevelsDone = false;
bool     g_openingRangeDone = false;
bool     g_tradeTaken = false;
bool     g_noonDone = false;

bool     g_positionManaged = false;
bool     g_hedging = false;
ulong    g_positionTicket = 0;
datetime g_entryBarStart = 0;
double   g_entryBuffer = 0.0;
int      g_levelAttempts[MAX_LEVELS];

datetime g_lastBlockLog = 0;
string   g_lastBlockMsg = "";
datetime g_lastSpreadLog = 0;
double   g_lastSpreadValue = -1.0;
datetime g_lastNoTargetLog = 0;

ulong FindOurPosition(int &count);
double FindTarget(const double entry,const double risk,const bool isLong,const double minRR);

//+------------------------------------------------------------------+
//| Time helpers                                                     |
//+------------------------------------------------------------------+
datetime MakeDateTime(const int year,const int month,const int day,
                      const int hour,const int minute,const int second)
{
   MqlDateTime dt;
   dt.year = year;
   dt.mon  = month;
   dt.day  = day;
   dt.hour = hour;
   dt.min  = minute;
   dt.sec  = second;
   return StructToTime(dt);
}

int DayOfWeek(const datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t,dt);
   return dt.day_of_week;
}

// US Eastern DST: second Sunday March 07:00 UTC -> first Sunday November 06:00 UTC.
bool IsUSEasternDST(const datetime gmt)
{
   MqlDateTime dt;
   TimeToStruct(gmt,dt);
   const int year = dt.year;

   datetime mar1 = MakeDateTime(year,3,1,0,0,0);
   int dow = DayOfWeek(mar1);
   int firstSunday = 1 + ((7 - dow) % 7);
   int secondSunday = firstSunday + 7;
   datetime dstStart = MakeDateTime(year,3,secondSunday,7,0,0);

   datetime nov1 = MakeDateTime(year,11,1,0,0,0);
   dow = DayOfWeek(nov1);
   int firstNovSunday = 1 + ((7 - dow) % 7);
   datetime dstEnd = MakeDateTime(year,11,firstNovSunday,6,0,0);

   return (gmt >= dstStart && gmt < dstEnd);
}

datetime ServerToNY(const datetime serverTime)
{
   datetime gmt = serverTime - g_serverOffsetSeconds;
   int offsetHours = IsUSEasternDST(gmt) ? -4 : -5;
   return gmt + offsetHours * 3600;
}

datetime NYToServer(const datetime ny)
{
   datetime gmt = ny + 5 * 3600;
   for(int i=0; i<2; i++)
      gmt = ny + (IsUSEasternDST(gmt) ? 4 : 5) * 3600;
   return gmt + g_serverOffsetSeconds;
}

datetime NowNY()
{
   return ServerToNY(TimeTradeServer());
}

int NYMinuteOfDay(const datetime ny)
{
   MqlDateTime dt;
   TimeToStruct(ny,dt);
   return dt.hour * 60 + dt.min;
}

int NYDateKey(const datetime ny)
{
   MqlDateTime dt;
   TimeToStruct(ny,dt);
   return dt.year * 10000 + dt.mon * 100 + dt.day;
}

datetime NYWeekStart(const datetime ny)
{
   MqlDateTime dt;
   TimeToStruct(ny,dt);
   int dow = dt.day_of_week;             // 0 Sunday, 1 Monday
   int daysSinceMonday = (dow + 6) % 7;
   datetime monday = ny - daysSinceMonday * 86400;
   MqlDateTime md;
   TimeToStruct(monday,md);
   md.hour = 0;
   md.min  = 0;
   md.sec  = 0;
   return StructToTime(md);
}

datetime WindowEndNY()
{
   datetime ny = NowNY();
   MqlDateTime dt;
   TimeToStruct(ny,dt);
   dt.hour = InpWindowEndHourNY;
   dt.min  = InpWindowEndMinNY;
   dt.sec  = 0;
   return StructToTime(dt);
}

//+------------------------------------------------------------------+
//| Price / symbol helpers                                           |
//+------------------------------------------------------------------+
double NormalizePrice(const double price)
{
   return NormalizeDouble(price,g_digits);
}

double PointValue()
{
   return SymbolInfoDouble(_Symbol,SYMBOL_POINT);
}

double CurrentSpreadPrice()
{
   long spreadPoints = SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   return (double)spreadPoints * PointValue();
}

double GetAtr()
{
   if(g_atrHandle == INVALID_HANDLE)
      return 0.0;

   double buf[];
   if(CopyBuffer(g_atrHandle,0,1,1,buf) != 1)
      return 0.0;
   return buf[0];
}

double GetAtrBuffer()
{
   double atr = GetAtr();
   double buffer = InpBufferFloor;
   if(InpAtrMultiplier > 0.0 && atr > 0.0)
      buffer = MathMax(buffer,InpAtrMultiplier * atr);
   return buffer;
}

double GetNYMinuteOpen(const int targetMinute)
{
   datetime nowNY = NowNY();
   int todayKey = NYDateKey(nowNY);

   for(int shift=0; shift<1440; shift++)
   {
      datetime t = iTime(_Symbol,PERIOD_M1,shift);
      if(t == 0)
         break;

      datetime ny = ServerToNY(t);
      if(NYDateKey(ny) != todayKey)
         break;

      if(NYMinuteOfDay(ny) == targetMinute)
         return iOpen(_Symbol,PERIOD_M1,shift);
   }
   return 0.0;
}

//+------------------------------------------------------------------+
//| Level construction                                               |
//+------------------------------------------------------------------+
void AddLevel(const string name,const double price,const bool isHigh,const bool entry)
{
   if(price <= 0.0 || price >= DBL_MAX / 2.0)
      return;

   // Avoid duplicate/near-duplicate levels.
   for(int i=0; i<g_levelCount; i++)
   {
      if(MathAbs(g_levels[i].price - price) < 0.05)
         return;
   }

   if(g_levelCount >= MAX_LEVELS)
      return;

   g_levels[g_levelCount].name   = name;
   g_levels[g_levelCount].price  = price;
   g_levels[g_levelCount].isHigh = isHigh;
   g_levels[g_levelCount].entry  = entry;
   g_levelOrdered[g_levelCount]    = false;
   g_levelAttempts[g_levelCount]   = 0;
   g_levelSkipLogged[g_levelCount] = false;
   g_levelCount++;
}

bool BuildCoreLevels()
{
   g_levelCount = 0;
   g_coreCount  = 0;
   for(int i=0; i<MAX_LEVELS; i++)
   {
      g_levelOrdered[i]    = false;
      g_levelAttempts[i]   = 0;
      g_levelSkipLogged[i] = false;
   }

   MqlRates rates[];
   int copied = CopyRates(_Symbol,PERIOD_M1,TimeCurrent() - 16 * 86400,TimeCurrent(),rates);
   if(copied <= 0)
   {
      Print("BuildCoreLevels: CopyRates failed, error=",GetLastError());
      return false;
   }
   ArraySetAsSeries(rates,false);

   datetime nowNY = NowNY();
   int todayKey = NYDateKey(nowNY);
   datetime currentWeekStart = NYWeekStart(nowNY);
   datetime previousNY = nowNY - 86400;
   int previousKey = NYDateKey(previousNY);

   int    priorRthKey = 0;
   double priorRthHigh = -DBL_MAX;
   double priorRthLow  =  DBL_MAX;
   double priorRthOpen = 0.0;
   double priorRthClose = 0.0;

   int    priorWeekKey = 0;
   double priorWeekHigh = -DBL_MAX;
   double priorWeekLow  =  DBL_MAX;

   double asiaHigh = -DBL_MAX;
   double asiaLow  =  DBL_MAX;
   double londonHigh = -DBL_MAX;
   double londonLow  =  DBL_MAX;

   for(int i=0; i<copied; i++)
   {
      datetime ny = ServerToNY(rates[i].time);
      MqlDateTime dt;
      TimeToStruct(ny,dt);

      int dateKey = dt.year * 10000 + dt.mon * 100 + dt.day;
      int minute = dt.hour * 60 + dt.min;
      bool rth = (minute >= 570 && minute < 960);   // 09:30-16:00 NY

      // Most recent prior RTH day.
      if(dateKey < todayKey && rth)
      {
         if(dateKey > priorRthKey)
         {
            priorRthKey = dateKey;
            priorRthHigh = rates[i].high;
            priorRthLow  = rates[i].low;
            priorRthOpen = rates[i].open;
            priorRthClose = rates[i].close;
         }
         else if(dateKey == priorRthKey)
         {
            priorRthHigh = MathMax(priorRthHigh,rates[i].high);
            priorRthLow  = MathMin(priorRthLow,rates[i].low);
            priorRthClose = rates[i].close;
         }
      }

      // Most recent prior week's RTH range.
      datetime weekStart = NYWeekStart(ny);
      if(weekStart < currentWeekStart && rth)
      {
         int weekKey = NYDateKey(weekStart);
         if(weekKey > priorWeekKey)
         {
            priorWeekKey = weekKey;
            priorWeekHigh = rates[i].high;
            priorWeekLow  = rates[i].low;
         }
         else if(weekKey == priorWeekKey)
         {
            priorWeekHigh = MathMax(priorWeekHigh,rates[i].high);
            priorWeekLow  = MathMin(priorWeekLow,rates[i].low);
         }
      }

      // Asian session: previous day 20:00-23:59 + today 00:00-01:59 NY.
      if((dateKey == todayKey && minute < 120) ||
         (dateKey == previousKey && minute >= 1200))
      {
         asiaHigh = MathMax(asiaHigh,rates[i].high);
         asiaLow  = MathMin(asiaLow,rates[i].low);
      }

      // London session: 02:00-04:59 NY.
      if(dateKey == todayKey && minute >= 120 && minute < 300)
      {
         londonHigh = MathMax(londonHigh,rates[i].high);
         londonLow  = MathMin(londonLow,rates[i].low);
      }
   }

   g_dailyBias = 0;
   if(priorRthOpen > 0.0 && priorRthClose > 0.0)
   {
      if(priorRthClose > priorRthOpen)
         g_dailyBias = 1;
      else if(priorRthClose < priorRthOpen)
         g_dailyBias = -1;
   }
   Print("DAILY BIAS=",(g_dailyBias > 0 ? "BULLISH" : (g_dailyBias < 0 ? "BEARISH" : "NEUTRAL")),
         " priorRTH open=",DoubleToString(priorRthOpen,g_digits),
         " close=",DoubleToString(priorRthClose,g_digits));

   if(priorRthHigh > -DBL_MAX && priorRthLow < DBL_MAX)
   {
      AddLevel("Prior RTH High",priorRthHigh,true,true);
      AddLevel("Prior RTH Low",priorRthLow,false,true);
   }

   if(priorWeekHigh > -DBL_MAX && priorWeekLow < DBL_MAX)
   {
      AddLevel("Prior Week High",priorWeekHigh,true,true);
      AddLevel("Prior Week Low",priorWeekLow,false,true);
   }

   if(asiaHigh > -DBL_MAX && asiaLow < DBL_MAX)
   {
      AddLevel("Asian High",asiaHigh,true,true);
      AddLevel("Asian Low",asiaLow,false,true);
   }

   if(londonHigh > -DBL_MAX && londonLow < DBL_MAX)
   {
      AddLevel("London High",londonHigh,true,true);
      AddLevel("London Low",londonLow,false,true);
   }

   // Core entry levels are the only ones eligible for the 09:30 gap-open entry.
   g_coreCount = g_levelCount;

   double midnightOpen = GetNYMinuteOpen(0);
   if(midnightOpen > 0.0)
      AddLevel("Midnight Open",midnightOpen,false,false);

   return (g_levelCount > 0);
}

bool AddOpenLevels()
{
   double open930 = GetNYMinuteOpen(570);
   if(open930 <= 0.0)
      return false;

   AddLevel("09:30 Open",open930,false,false);
   return true;
}

bool AddOpeningRangeLevels()
{
   datetime nowNY = NowNY();
   int todayKey = NYDateKey(nowNY);

   double hi = -DBL_MAX;
   double lo =  DBL_MAX;

   for(int shift=0; shift<180; shift++)
   {
      datetime t = iTime(_Symbol,PERIOD_M1,shift);
      if(t == 0)
         break;

      datetime ny = ServerToNY(t);
      if(NYDateKey(ny) != todayKey)
         break;

      int minute = NYMinuteOfDay(ny);
      if(minute >= 570 && minute < 600)
      {
         hi = MathMax(hi,iHigh(_Symbol,PERIOD_M1,shift));
         lo = MathMin(lo,iLow(_Symbol,PERIOD_M1,shift));
      }
   }

   if(hi <= 0.0 || lo >= DBL_MAX || hi < lo)
      return false;

   AddLevel("Opening Range High",hi,true,true);
   AddLevel("Opening Range Low",lo,false,true);
   return true;
}

void LogLevels(const string tag)
{
   Print("--- LEVELS ",tag," | NY ",TimeToString(NowNY(),TIME_DATE|TIME_MINUTES),
         " | count=",g_levelCount);
   for(int i=0; i<g_levelCount; i++)
   {
      Print("    ",(g_levels[i].entry ? "ENTRY  " : "TARGET "),
            g_levels[i].name," ",
            DoubleToString(g_levels[i].price,g_digits),
            (g_levels[i].isHigh ? " HIGH" : " LOW"));
   }
}

//+------------------------------------------------------------------+
//| Trade safety                                                     |
//+------------------------------------------------------------------+
void LogBlocked(const string msg)
{
   if(msg != g_lastBlockMsg || TimeCurrent() - g_lastBlockLog >= 300)
   {
      Print("TRADE BLOCKED: ",msg);
      g_lastBlockMsg = msg;
      g_lastBlockLog = TimeCurrent();
   }
}

bool CanTrade()
{
   if(!InpTradingEnabled)
      return false;

   bool tester = (bool)MQLInfoInteger(MQL_TESTER);

   if(InpDemoOnly && !tester)
   {
      long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
      if(mode != ACCOUNT_TRADE_MODE_DEMO)
      {
         LogBlocked("account is not a demo account");
         return false;
      }
   }

   if(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) == 0)
   {
      LogBlocked("terminal auto-trading is disabled");
      return false;
   }

   if(MQLInfoInteger(MQL_TRADE_ALLOWED) == 0)
   {
      LogBlocked("EA auto-trading is disabled");
      return false;
   }

   if(AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) == 0)
   {
      LogBlocked("account trading is disabled");
      return false;
   }

   ENUM_SYMBOL_TRADE_MODE symbolMode =
      (ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE);
   if(symbolMode != SYMBOL_TRADE_MODE_FULL)
   {
      LogBlocked("symbol is not fully tradable");
      return false;
   }

   return true;
}

bool SpreadOK()
{
   double spread = CurrentSpreadPrice();
   if(spread <= g_maxSpread)
      return true;

   if(TimeCurrent() - g_lastSpreadLog >= 60 ||
      MathAbs(spread - g_lastSpreadValue) >= 0.2)
   {
      Print("SPREAD TOO WIDE: ",DoubleToString(spread,g_digits),
            " > ",DoubleToString(g_maxSpread,2),
            " price points. Skipping entries.");
      g_lastSpreadLog = TimeCurrent();
      g_lastSpreadValue = spread;
   }
   return false;
}

bool PriceValidForLimit(const double price,const bool isHigh)
{
   double bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   if(bid <= 0.0 || ask <= 0.0)
      return false;

   double stops = (double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double freeze = (double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double distance = MathMax(stops,freeze) * PointValue();

   if(isHigh)
      return (price >= ask + distance);
   return (price <= bid - distance);
}

double LevelMinDistance()
{
   double stops = (double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double freeze = (double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   return MathMax(MathMax(stops,freeze) * PointValue(),PointValue());
}

bool MarketOpen()
{
   datetime last = (datetime)SymbolInfoInteger(_Symbol,SYMBOL_TIME);
   if(last == 0)
      return false;
   return (TimeTradeServer() - last <= 180);
}

bool BiasAllows(const bool isHigh)
{
   if(!InpUseDailyBias || g_dailyBias == 0)
      return true;
   // Highs are shorts (need bearish bias); lows are longs (need bullish bias).
   return (isHigh ? (g_dailyBias < 0) : (g_dailyBias > 0));
}

bool MondayBlocked()
{
   if(!InpSkipMonday || DayOfWeek(NowNY()) != 1)
      return false;
   if(!g_mondayLogged)
   {
      Print("MONDAY SKIP: no new entries today (NY Monday).");
      g_mondayLogged = true;
   }
   return true;
}

double EstimatedLimitRisk()
{
   // The real stop is only known after the entry M1 bar closes. Use a
   // conservative proxy so we do not place limits that cannot reach minRR.
   double buffer = GetAtrBuffer();
   double estimate = MathMax(buffer * 1.25, 8.0);
   return estimate;
}

// Conservative distance for sizing pending orders. The provisional stop and
// the eventual structural stop can be wider than EstimatedLimitRisk(), so do
// not size on the optimistic estimate alone.
double SizingRiskDistance()
{
   double d = MathMax(EstimatedLimitRisk(),30.0);
   if(InpUseProvisionalStop)
   {
      d = MathMax(d,InpProvisionalStopAtrMult * GetAtr());
      d = MathMax(d,3.0 * GetAtrBuffer());
   }
   return d;
}

double ProjectedRRForPrice(const double price,const bool isHigh)
{
   double estimate = EstimatedLimitRisk();
   if(estimate <= 0.0)
      return 0.0;
   double target = FindTarget(price,estimate,!isHigh,0.0);
   if(target <= 0.0)
      return 0.0;
   return MathAbs(target - price) / estimate;
}

double LossPerLotForRisk(const double riskPrice)
{
   if(riskPrice <= 0.0 || g_tickSize <= 0.0 || g_tickValue <= 0.0)
      return 0.0;
   return (riskPrice / g_tickSize) * g_tickValue;
}

double RiskUSDForPercent(const double percent)
{
   return AccountInfoDouble(ACCOUNT_EQUITY) * percent / 100.0;
}

double MaxRiskUSD()
{
   return RiskUSDForPercent(InpRiskPercentMax);
}

// Quality score uses only features available at entry time. It is a
// hypothesis-based score, not a validated model; A+ risk above 3% is gated
// behind InpAPlusValidated.
int QualityScore(const string name,const bool isHigh,const double rr,
                 const double stopDistance,const bool isGap)
{
   int score = 0;

   if(StringFind(name,"Prior RTH High") >= 0)       score += 3;
   else if(StringFind(name,"Prior Week High") >= 0)  score += 3;
   else if(StringFind(name,"Prior RTH Low") >= 0)    score += 2;
   else if(StringFind(name,"Asian High") >= 0)       score += 2;
   else if(StringFind(name,"London High") >= 0)      score += 1;
   else if(StringFind(name,"Asian Low") >= 0)        score += 1;
   else if(StringFind(name,"London Low") >= 0)       score += 1;
   else if(StringFind(name,"Prior Week Low") >= 0)   score += 1;
   else if(StringFind(name,"Opening Range High") >= 0) score -= 1;
   else if(StringFind(name,"Opening Range Low") >= 0)  score -= 2;

   if(isHigh) score += 1;                    // shorts were the stronger side
   if(rr >= 8.0)      score += 3;
   else if(rr >= 5.0) score += 2;
   else if(rr >= 4.0) score += 1;

   if(stopDistance <= 30.0) score += 1;
   else if(stopDistance > 50.0) score -= 1;

   if(isGap) score -= 2;
   else if(DayOfWeek(NowNY()) == 1) score += 1;  // Monday was strong in-sample

   return score;
}

int QualityTier(const int score)
{
   if(score <= 2) return 0;   // low
   if(score <= 4) return 1;   // standard
   if(score <= 6) return 2;   // A
   return 3;                  // A+
}

string QualityTierName(const int tier)
{
   if(tier == 0) return "LOW";
   if(tier == 1) return "STANDARD";
   if(tier == 2) return "A";
   return "A+";
}

double RiskPercentForSetup(const string name,const bool isHigh,const double rr,
                           const double stopDistance,const bool isGap)
{
   int score = QualityScore(name,isHigh,rr,stopDistance,isGap);
   int tier  = QualityTier(score);
   double pct = InpRiskPercentMin;

   if(tier == 1)
      pct = 1.5 + (score - 3) * 0.5;        // 1.5-2.0%
   else if(tier == 2)
      pct = 2.5 + (score - 5) * 0.5;        // 2.5-3.0%
   else if(tier == 3)
   {
      if(InpAPlusValidated)
         pct = 3.0 + (score - 7) * 1.0;     // 3-5% only after validation
      else
         pct = MathMin(3.0,InpRiskPercentMax);
   }

   return MathMax(InpRiskPercentMin,MathMin(InpRiskPercentMax,pct));
}

double RiskUSDForSetup(const string name,const bool isHigh,const double rr,
                       const double stopDistance,const bool isGap)
{
   return RiskUSDForPercent(RiskPercentForSetup(name,isHigh,rr,stopDistance,isGap));
}

// Lot that risks the requested dollar amount at this stop distance. Rounded
// down. If the target is below the minimum lot, use the minimum lot when its
// risk still fits inside the maximum percentage.
double LotForRisk(const double riskPrice,const double riskUSD,const bool allowMinLot=true)
{
   double lossPerLot = LossPerLotForRisk(riskPrice);
   if(riskUSD <= 0.0 || lossPerLot <= 0.0)
      return 0.0;

   double raw = riskUSD / lossPerLot;
   double lot = MathFloor(raw / g_lotStep) * g_lotStep;
   double cap = (InpMaxLot > 0.0 ? MathMin(InpMaxLot,g_maxLot) : g_maxLot);
   lot = MathMin(lot,cap);

   if(lot < g_minLot)
   {
      if(!allowMinLot)
         return 0.0;
      if(RiskUSDForVolume(riskPrice,g_minLot) > MaxRiskUSD() + 0.005)
         return 0.0;
      return NormalizeDouble(g_minLot,2);
   }

   return NormalizeDouble(lot,2);
}

double RiskUSDForVolume(const double riskPrice,const double volume)
{
   return LossPerLotForRisk(riskPrice) * volume;
}

// After the real structural stop is known, cut the position only if its actual
// dollar risk exceeds the 1-5% maximum. Returns false when a reduction was
// made so the caller can re-read the position on the next tick.
bool EnforceRiskBudget(const ulong ticket,const double riskPrice)
{
   double volume = PositionGetDouble(POSITION_VOLUME);
   if(volume <= 0.0)
      return true;

   double maxRisk = MaxRiskUSD();
   double allowed = LotForRisk(riskPrice,maxRisk,true);
   if(allowed <= 0.0)
   {
      Print("RISK BUDGET: minimum lot would exceed $",DoubleToString(maxRisk,2),
            " (",DoubleToString(InpRiskPercentMax,2),"%) at risk ",
            DoubleToString(riskPrice,g_digits),"p; closing position.");
      if(!g_trade.PositionClose(ticket))
         Print("RISK BUDGET close failed retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());
      return false;
   }

   if(volume > allowed + g_lotStep * 0.5)
   {
      double excess = NormalizeDouble(volume - allowed,2);
      Print("RISK BUDGET: actual risk $",DoubleToString(RiskUSDForVolume(riskPrice,volume),2),
            " (",DoubleToString(100.0 * RiskUSDForVolume(riskPrice,volume) /
            MathMax(1.0,AccountInfoDouble(ACCOUNT_EQUITY)),2),"% ) > max $",
            DoubleToString(maxRisk,2),
            "; reducing ",DoubleToString(volume,2)," to ",DoubleToString(allowed,2));
      if(!g_trade.PositionClosePartial(ticket,excess))
         Print("RISK BUDGET reduce failed retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());
      return false;
   }

   return true;
}

// If price gaps through a pre-existing core level at 09:30, the resting
// limit would have filled at the open. The EA enters at market instead of
// skipping the level. Later opening-range levels are not gap entries.
bool TryGapEntryCore()
{
   double bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   if(bid <= 0.0 || ask <= 0.0)
      return false;

   // Gap entries were weak in testing; treat them as low tier.
   double gapRiskUSD = RiskUSDForPercent(InpRiskPercentMin);
   double sizingRisk = SizingRiskDistance();
   double orderLot = LotForRisk(sizingRisk,gapRiskUSD,true);
   if(orderLot <= 0.0)
   {
      Print("RISK SKIP gap entry: $",DoubleToString(gapRiskUSD,2),
            " cannot be met at sizing risk ",DoubleToString(sizingRisk,g_digits),"p");
      return false;
   }
   g_lot = orderLot;

   double distance = LevelMinDistance();
   for(int i=0; i<g_coreCount; i++)
   {
      if(!g_levels[i].entry || g_levelOrdered[i])
         continue;
      if(!BiasAllows(g_levels[i].isHigh))
         continue;

      double level = g_levels[i].price;
      double limit = NormalizePrice(level +
                     (g_levels[i].isHigh ? InpLimitOffsetPoints : -InpLimitOffsetPoints));
      string comment = StringSubstr("CRT gap " + g_levels[i].name,0,31);

      if(g_levels[i].isHigh)
      {
         if(ask < limit + distance)
            continue;
         if(g_trade.Sell(g_lot,_Symbol,0.0,0.0,0.0,comment))
         {
            g_tradeTaken = true;
            Print("GAP ENTRY SHORT ",g_levels[i].name," at market ",
                  DoubleToString(ask,g_digits)," (level ",DoubleToString(level,g_digits),")");
            return true;
         }
         Print("GAP ENTRY SHORT FAILED ",g_levels[i].name,
               " retcode=",g_trade.ResultRetcode()," ",g_trade.ResultComment());
         return false;
      }

      if(bid > limit - distance)
         continue;
      if(g_trade.Buy(g_lot,_Symbol,0.0,0.0,0.0,comment))
      {
         g_tradeTaken = true;
         Print("GAP ENTRY LONG ",g_levels[i].name," at market ",
               DoubleToString(bid,g_digits)," (level ",DoubleToString(level,g_digits),")");
         return true;
      }
      Print("GAP ENTRY LONG FAILED ",g_levels[i].name,
            " retcode=",g_trade.ResultRetcode()," ",g_trade.ResultComment());
      return false;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Orders / positions                                               |
//+------------------------------------------------------------------+
void DeletePendingOrders()
{
   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0)
         continue;

      if(OrderGetString(ORDER_SYMBOL) != _Symbol)
         continue;

      if((ulong)OrderGetInteger(ORDER_MAGIC) != (ulong)InpMagic)
         continue;

      if(!g_trade.OrderDelete(ticket))
         Print("Delete pending failed ticket=",ticket,
               " retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());
   }
}

void PlaceOrders()
{
   if(g_tradeTaken || !g_coreLevelsDone)
      return;

   if(MondayBlocked())
      return;

   if(!MarketOpen())
      return;

   int posCount = 0;
   if(FindOurPosition(posCount) != 0)
   {
      g_tradeTaken = true;
      DeletePendingOrders();
      return;
   }

   int minute = NYMinuteOfDay(NowNY());
   int levelsMinute = InpLevelsHourNY * 60 + InpLevelsMinNY;
   int windowStart = InpWindowStartHourNY * 60 + InpWindowStartMinNY;
   int windowEnd = InpWindowEndHourNY * 60 + InpWindowEndMinNY;
   // Place core limits as soon as levels are built (09:25), so they are
   // resting for the open. The entry window still begins at 09:30.
   if(minute < levelsMinute || minute >= windowEnd)
      return;

   if(!InpTradingEnabled)
   {
      Print("LOG-ONLY spread=",DoubleToString(CurrentSpreadPrice(),g_digits),
            " price points; ATR buffer=",DoubleToString(GetAtrBuffer(),g_digits),
            "; risk range=",DoubleToString(InpRiskPercentMin,2),"-",
            DoubleToString(InpRiskPercentMax,2),"%");
      for(int i=0; i<g_levelCount; i++)
      {
         if(!g_levels[i].entry || g_levelOrdered[i])
            continue;

         if(!BiasAllows(g_levels[i].isHigh))
         {
            Print("LOG-ONLY: bias skip ",g_levels[i].name);
            g_levelOrdered[i] = true;
            continue;
         }

         double price = NormalizePrice(g_levels[i].price +
                        (g_levels[i].isHigh ? InpLimitOffsetPoints : -InpLimitOffsetPoints));

         double projectedRR = ProjectedRRForPrice(price,g_levels[i].isHigh);
         if(projectedRR <= 0.0 ||
            (InpPreFilterMinRR && InpMinRewardRisk > 0.0 &&
             projectedRR < InpMinRewardRisk))
         {
            Print("LOG-ONLY: min-RR skip ",g_levels[i].name,
                  " at ",DoubleToString(price,g_digits),
                  " projectedRR=",DoubleToString(projectedRR,2));
            g_levelOrdered[i] = true;
            continue;
         }

         double sizingRisk = SizingRiskDistance();
         int quality = QualityScore(g_levels[i].name,g_levels[i].isHigh,
                                    projectedRR,sizingRisk,false);
         int tier = QualityTier(quality);
         if(tier == 0 && InpSkipLowQuality)
         {
            Print("LOG-ONLY: low-quality skip ",g_levels[i].name,
                  " score=",quality," tier=",QualityTierName(tier));
            g_levelOrdered[i] = true;
            continue;
         }
         double riskPct = RiskPercentForSetup(g_levels[i].name,g_levels[i].isHigh,
                                              projectedRR,sizingRisk,false);
         double riskUSD = RiskUSDForPercent(riskPct);
         double orderLot = LotForRisk(sizingRisk,riskUSD,true);
         if(orderLot <= 0.0)
         {
            Print("LOG-ONLY: risk skip ",g_levels[i].name,
                  " risk $",DoubleToString(riskUSD,2),
                  " at ",DoubleToString(sizingRisk,g_digits),"p");
            g_levelOrdered[i] = true;
            continue;
         }

         Print("LOG-ONLY: would place ",
               (g_levels[i].isHigh ? "SELL LIMIT " : "BUY LIMIT "),
               g_levels[i].name," at ",DoubleToString(price,g_digits),
               " lot=",DoubleToString(orderLot,2),
               " rr=",DoubleToString(projectedRR,2),
               " score=",quality," tier=",QualityTierName(tier),
               " risk=",DoubleToString(riskPct,2),"%/$",DoubleToString(riskUSD,2));
         g_levelOrdered[i] = true;
      }
      return;
   }

   if(!CanTrade())
      return;

   if(!SpreadOK())
      return;

   datetime expiration = NYToServer(WindowEndNY());
   if(expiration <= TimeCurrent() + 30)
      return;

   // A gap through a core level at the open would have filled a resting limit.
   // Enter the first (highest-priority) gapped core level at market.
   if(minute >= windowStart && minute < 600 && TryGapEntryCore())
   {
      DeletePendingOrders();
      return;
   }

   for(int i=0; i<g_levelCount; i++)
   {
      if(!g_levels[i].entry || g_levelOrdered[i])
         continue;

      if(!BiasAllows(g_levels[i].isHigh))
      {
         if(!g_levelSkipLogged[i])
         {
            Print("BIAS SKIP ",g_levels[i].name,
                  " (daily bias=",(g_dailyBias > 0 ? "bullish" : (g_dailyBias < 0 ? "bearish" : "neutral")),")");
            g_levelSkipLogged[i] = true;
         }
         continue;
      }

      double offset = g_levels[i].isHigh ? InpLimitOffsetPoints : -InpLimitOffsetPoints;
      double price = NormalizePrice(g_levels[i].price + offset);

      if(!PriceValidForLimit(price,g_levels[i].isHigh))
      {
         // Do not give up for the day: the level can become valid after price
         // moves. Retry each tick, but only log the first skip.
         if(!g_levelSkipLogged[i])
         {
            Print("WAITING ",g_levels[i].name," at ",DoubleToString(price,g_digits),
                  ": too close to market or wrong side.");
            g_levelSkipLogged[i] = true;
         }
         continue;
      }

      double projectedRR = ProjectedRRForPrice(price,g_levels[i].isHigh);
      if(projectedRR <= 0.0 ||
         (InpPreFilterMinRR && InpMinRewardRisk > 0.0 &&
          projectedRR < InpMinRewardRisk))
      {
         if(!g_levelSkipLogged[i])
         {
            Print("MIN-RR SKIP ",g_levels[i].name,
                  " at ",DoubleToString(price,g_digits),
                  ": projected ",DoubleToString(projectedRR,2),"R < ",
                  DoubleToString(InpMinRewardRisk,1),"R",
                  " (est risk ",DoubleToString(EstimatedLimitRisk(),g_digits),")");
            g_levelSkipLogged[i] = true;
         }
         continue;
      }

      double sizingRisk = SizingRiskDistance();
      int quality = QualityScore(g_levels[i].name,g_levels[i].isHigh,
                                 projectedRR,sizingRisk,false);
      int tier = QualityTier(quality);
      if(tier == 0 && InpSkipLowQuality)
      {
         if(!g_levelSkipLogged[i])
         {
            Print("LOW-QUALITY SKIP ",g_levels[i].name,
                  " score=",quality," tier=",QualityTierName(tier));
            g_levelSkipLogged[i] = true;
         }
         continue;
      }
      double riskPct = RiskPercentForSetup(g_levels[i].name,g_levels[i].isHigh,
                                           projectedRR,sizingRisk,false);
      double riskUSD = RiskUSDForPercent(riskPct);
      double orderLot = LotForRisk(sizingRisk,riskUSD,true);
      if(orderLot <= 0.0)
      {
         if(!g_levelSkipLogged[i])
         {
            Print("RISK SKIP ",g_levels[i].name,
                  " risk $",DoubleToString(riskUSD,2),
                  " cannot be met at sizing risk ",
                  DoubleToString(sizingRisk,g_digits),"p");
            g_levelSkipLogged[i] = true;
         }
         continue;
      }
      g_lot = orderLot;

      string comment = StringSubstr("CRT " + g_levels[i].name,0,31);
      bool ok = false;

      if(g_levels[i].isHigh)
         ok = g_trade.SellLimit(orderLot,price,_Symbol,0.0,0.0,
                                ORDER_TIME_SPECIFIED,expiration,comment);
      else
         ok = g_trade.BuyLimit(orderLot,price,_Symbol,0.0,0.0,
                               ORDER_TIME_SPECIFIED,expiration,comment);

      if(!ok)
      {
         // Some brokers reject time-specified pending orders. Fall back to GTC;
         // the EA deletes all remaining pendings at 10:30 NY.
         if(g_trade.ResultRetcode() == TRADE_RETCODE_INVALID_EXPIRATION)
         {
            if(g_levels[i].isHigh)
               ok = g_trade.SellLimit(orderLot,price,_Symbol,0.0,0.0,
                                      ORDER_TIME_GTC,0,comment);
            else
               ok = g_trade.BuyLimit(orderLot,price,_Symbol,0.0,0.0,
                                     ORDER_TIME_GTC,0,comment);
         }
      }

      if(ok)
      {
         g_levelAttempts[i]   = 0;
         g_levelOrdered[i]    = true;
         g_levelSkipLogged[i] = false;
         Print("PLACED ",
               (g_levels[i].isHigh ? "SELL LIMIT " : "BUY LIMIT "),
               g_levels[i].name," at ",DoubleToString(price,g_digits),
               " lot=",DoubleToString(orderLot,2),
               " rr=",DoubleToString(projectedRR,2),
               " score=",quality," tier=",QualityTierName(tier),
               " risk=",DoubleToString(riskPct,2),"%/$",DoubleToString(riskUSD,2),
               " ticket=",g_trade.ResultOrder());
      }
      else
      {
         g_levelAttempts[i]++;
         Print("ORDER NOT PLACED ",g_levels[i].name,
               " attempt=",g_levelAttempts[i],
               " retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());

         // Retry transient failures a couple of times, then give up for the day.
         if(g_levelAttempts[i] >= 3)
            g_levelOrdered[i] = true;
      }
   }
}

ulong FindOurPosition(int &count)
{
   count = 0;
   ulong first = 0;
   datetime firstTime = 0;
   long firstId = 0;

   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;

      if((ulong)PositionGetInteger(POSITION_MAGIC) != (ulong)InpMagic)
         continue;

      count++;
      datetime ptime = (datetime)PositionGetInteger(POSITION_TIME);
      long pid = (long)PositionGetInteger(POSITION_IDENTIFIER);
      bool earlier = (ptime < firstTime)
                     || (ptime == firstTime && pid < firstId)
                     || (ptime == firstTime && pid == firstId && ticket < first);
      if(first == 0 || earlier)
      {
         first = ticket;
         firstTime = ptime;
         firstId = pid;
      }
   }
   return first;
}

void CloseExtraPositions(const ulong keep)
{
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || ticket == keep)
         continue;

      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;

      if((ulong)PositionGetInteger(POSITION_MAGIC) != (ulong)InpMagic)
         continue;

      if(!g_trade.PositionClose(ticket))
         Print("Close extra position failed ticket=",ticket,
               " retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());
   }
}

double FindTarget(const double entry,const double risk,const bool isLong,const double minRR)
{
   double best = 0.0;

   for(int i=0; i<g_levelCount; i++)
   {
      double p = g_levels[i].price;
      if(p <= 0.0)
         continue;

      if(isLong)
      {
         if(p >= entry + risk && (best == 0.0 || p < best))
            best = p;
      }
      else
      {
         if(p <= entry - risk && (best == 0.0 || p > best))
            best = p;
      }
   }
   if(best <= 0.0)
      return 0.0;

   double targetR = MathAbs(best - entry) / risk;
   if(minRR > 0.0 && targetR < minRR)
      return 0.0;
   return best;
}

void ManagePositions()
{
   int count = 0;
   ulong ticket = FindOurPosition(count);

   if(ticket == 0)
   {
      if(g_positionTicket != 0)
      {
         Print("POSITION CLOSED ticket=",g_positionTicket);
         g_positionTicket = 0;
         g_positionManaged = false;
      }
      return;
   }

   g_tradeTaken = true;
   DeletePendingOrders();

   if(count > 1)
   {
      Print("Multiple positions detected (",count,"); keeping first ticket=",ticket,
            " and closing extras.");
      CloseExtraPositions(ticket);
   }

   // On a netting account, two simultaneous fills become one oversized
   // position. Reduce it to the intended lot before managing the stop/target.
   if(!g_hedging && PositionSelectByTicket(ticket))
   {
      double volume = PositionGetDouble(POSITION_VOLUME);
      double stepLot = SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
      if(stepLot <= 0.0)
         stepLot = 0.01;
      if(volume > g_lot + stepLot * 0.5)
      {
         double excess = NormalizeDouble(volume - g_lot,2);
         Print("NETTING OVERFILL: volume=",DoubleToString(volume,2),
               " reducing by ",DoubleToString(excess,2),
               " ticket=",ticket);
         if(!g_trade.PositionClosePartial(ticket,excess))
            Print("NETTING OVERFILL reduce failed retcode=",g_trade.ResultRetcode(),
                  " ",g_trade.ResultComment());
         return;
      }
   }

   if(g_positionTicket != ticket)
   {
      g_positionTicket = ticket;
      g_positionManaged = false;
      g_entryBarStart = 0;
      g_entryBuffer = 0.0;
   }

   if(!PositionSelectByTicket(ticket))
      return;

   bool isLong = ((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   double entry = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl = PositionGetDouble(POSITION_SL);

   if(g_entryBarStart == 0)
   {
      datetime fillTime = (datetime)PositionGetInteger(POSITION_TIME);
      int shift = iBarShift(_Symbol,PERIOD_M1,fillTime,false);
      if(shift < 0)
         shift = 0;
      g_entryBarStart = iTime(_Symbol,PERIOD_M1,shift);
      g_entryBuffer = GetAtrBuffer();

      Print("POSITION OPEN ticket=",ticket,
            " ",(isLong ? "LONG" : "SHORT"),
            " lot=",DoubleToString(PositionGetDouble(POSITION_VOLUME),2),
            " entry=",DoubleToString(entry,g_digits));
   }

   // Temporary wide stop while the entry M1 bar is still forming.
   if(InpUseProvisionalStop && sl == 0.0 && !g_positionManaged)
   {
      double atr = GetAtr();
      double buffer = GetAtrBuffer();
      double distance = MathMax(InpProvisionalStopAtrMult * atr,3.0 * buffer);
      if(distance < 30.0)
         distance = 30.0;

      double provisional = NormalizePrice(isLong ? entry - distance : entry + distance);
      if(g_trade.PositionModify(ticket,provisional,0.0))
         Print("Provisional stop set at ",DoubleToString(provisional,g_digits));
      else
         Print("Provisional stop failed retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());
   }

   datetime currentBar = iTime(_Symbol,PERIOD_M1,0);
   if(currentBar <= 0 || currentBar <= g_entryBarStart || g_positionManaged)
      return;

   // Entry bar has closed: apply the structural stop and nearest liquidity target.
   int shift = iBarShift(_Symbol,PERIOD_M1,g_entryBarStart,true);
   if(shift < 0)
      shift = iBarShift(_Symbol,PERIOD_M1,g_entryBarStart,false);
   if(shift < 0)
      return;

   double barLow = iLow(_Symbol,PERIOD_M1,shift);
   double barHigh = iHigh(_Symbol,PERIOD_M1,shift);
   if(barLow <= 0.0 || barHigh <= 0.0)
      return;

   double buffer = (g_entryBuffer > 0.0 ? g_entryBuffer : GetAtrBuffer());
   double stop = isLong ? barLow - buffer : barHigh + buffer;

   double stops = (double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double freeze = (double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minDistance = MathMax(stops,freeze) * PointValue();

   if(isLong && entry - stop < minDistance)
      stop = entry - minDistance;
   if(!isLong && stop - entry < minDistance)
      stop = entry + minDistance;

   stop = NormalizePrice(stop);
   double risk = isLong ? entry - stop : stop - entry;

   if(risk <= PointValue())
   {
      Print("Structural risk too small; keeping provisional stop.");
      return;
   }

   if(!EnforceRiskBudget(ticket,risk))
      return;

   double target = FindTarget(entry,risk,isLong,InpMinRewardRisk);
   if(target > 0.0)
   {
      target = NormalizePrice(target);
      if(g_trade.PositionModify(ticket,stop,target))
      {
         g_positionManaged = true;
         Print("STRUCTURE SET stop=",DoubleToString(stop,g_digits),
               " target=",DoubleToString(target,g_digits),
               " risk=",DoubleToString(risk,g_digits),
               " riskUSD=",DoubleToString(RiskUSDForVolume(risk,PositionGetDouble(POSITION_VOLUME)),2),
               " rr=",DoubleToString((isLong ? target-entry : entry-target)/risk,2));
      }
      else
      {
         Print("Set structural SL/TP failed retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());
      }
   }
   else
   {
      // The backtest skipped setups without a >=1R opposing level. Live, the
      // limit has already filled, so the honest equivalent is to exit.
      if(TimeCurrent() - g_lastNoTargetLog >= 60)
      {
         Print("NO TARGET >= ",DoubleToString(MathMax(1.0,InpMinRewardRisk),1),
               "R; closing position at market.");
         g_lastNoTargetLog = TimeCurrent();
      }
      if(g_trade.PositionClose(ticket))
         g_positionManaged = true;
      else
         Print("No-target close failed retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());
   }
}

void CloseAllPositions()
{
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;

      if((ulong)PositionGetInteger(POSITION_MAGIC) != (ulong)InpMagic)
         continue;

      if(!g_trade.PositionClose(ticket))
         Print("Position close failed ticket=",ticket,
               " retcode=",g_trade.ResultRetcode(),
               " ",g_trade.ResultComment());
      else
         Print("POSITION CLOSE ticket=",ticket);
   }
}

//+------------------------------------------------------------------+
//| Daily state                                                      |
//+------------------------------------------------------------------+
bool HasTradedToday()
{
   datetime nowNY = NowNY();
   int todayKey = NYDateKey(nowNY);
   datetime from = TimeCurrent() - 2 * 86400;

   if(!HistorySelect(from,TimeCurrent()))
      return false;

   int total = HistoryDealsTotal();
   for(int i=0; i<total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;

      if(HistoryDealGetString(ticket,DEAL_SYMBOL) != _Symbol)
         continue;

      if((ulong)HistoryDealGetInteger(ticket,DEAL_MAGIC) != (ulong)InpMagic)
         continue;

      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket,DEAL_ENTRY) != DEAL_ENTRY_IN)
         continue;

      datetime dealTime = (datetime)HistoryDealGetInteger(ticket,DEAL_TIME);
      if(NYDateKey(ServerToNY(dealTime)) == todayKey)
         return true;
   }
   return false;
}

void ResetDaily(const int dayKey)
{
   bool firstRun = (g_dayKey == 0);
   g_dayKey = dayKey;
   g_levelCount = 0;
   g_coreCount  = 0;
   for(int i=0; i<MAX_LEVELS; i++)
   {
      g_levelOrdered[i]    = false;
      g_levelAttempts[i]   = 0;
      g_levelSkipLogged[i] = false;
   }

   g_coreLevelsDone = false;
   g_openLevelsDone = false;
   g_openingRangeDone = false;
   g_noonDone = false;
   g_dailyBias = 0;
   g_mondayLogged = false;

   g_positionTicket = 0;
   g_positionManaged = false;
   g_entryBarStart = 0;
   g_entryBuffer = 0.0;

   if(InpServerGMTOffsetHours == 999)
      g_serverOffsetSeconds = (int)(TimeTradeServer() - TimeGMT());

   // On a real day rollover the strategy should be flat. On first startup,
   // leave a position opened today for ManagePositions() to adopt, but close
   // anything stale from a previous day.
   bool tradedToday = HasTradedToday();
   if(!firstRun || !tradedToday)
      CloseAllPositions();
   DeletePendingOrders();
   g_tradeTaken = tradedToday;

   Print("=== NEW NY DAY ",dayKey," | server GMT offset ",
         IntegerToString(g_serverOffsetSeconds / 3600),"h ===");
   if(g_tradeTaken)
      Print("Already traded today; no new entries.");
}

void ProcessDay()
{
   datetime ny = NowNY();
   int dayKey = NYDateKey(ny);
   if(dayKey != g_dayKey)
      ResetDaily(dayKey);

   int minute = NYMinuteOfDay(ny);
   int windowStart = InpWindowStartHourNY * 60 + InpWindowStartMinNY;
   int windowEnd = InpWindowEndHourNY * 60 + InpWindowEndMinNY;

   if(!g_coreLevelsDone && minute >= InpLevelsHourNY * 60 + InpLevelsMinNY)
   {
      if(BuildCoreLevels())
      {
         g_coreLevelsDone = true;
         LogLevels("core");
      }
   }

   if(g_coreLevelsDone && !g_openLevelsDone && minute >= 570)
   {
      if(AddOpenLevels())
      {
         g_openLevelsDone = true;
         LogLevels("09:30 open");
      }
   }

   if(g_coreLevelsDone && minute >= InpLevelsHourNY * 60 + InpLevelsMinNY &&
      minute < windowEnd)
      PlaceOrders();

   if(g_coreLevelsDone && !g_openingRangeDone && minute >= 600 && minute < windowEnd)
   {
      if(AddOpeningRangeLevels())
      {
         g_openingRangeDone = true;
         LogLevels("after opening range");
         PlaceOrders();
      }
   }

   if(minute >= windowEnd)
      DeletePendingOrders();

   if(minute >= InpExitHourNY * 60 + InpExitMinNY)
   {
      if(!g_noonDone)
      {
         Print("NOON EXIT WINDOW: flattening and cancelling pendings.");
         g_noonDone = true;
      }
      CloseAllPositions();
      DeletePendingOrders();
   }
}

//+------------------------------------------------------------------+
//| MQL5 event handlers                                              |
//+------------------------------------------------------------------+
int OnInit()
{
   g_digits = (int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   g_maxSpread = (InpMaxSpreadPricePoints > 0.0 ? InpMaxSpreadPricePoints : 2.5);

   double minLot = SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double step   = SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);

   if(minLot <= 0.0)
      minLot = 0.01;
   if(step <= 0.0)
      step = 0.01;
   if(maxLot <= 0.0)
      maxLot = 100.0;

   g_minLot = minLot;
   g_maxLot = maxLot;
   g_lotStep = step;
   g_tickSize = SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   g_tickValue = SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   if(g_tickSize <= 0.0)
      g_tickSize = PointValue();
   if(g_tickValue <= 0.0)
      g_tickValue = SymbolInfoDouble(_Symbol,SYMBOL_TRADE_CONTRACT_SIZE) * g_tickSize;
   if(g_tickValue <= 0.0)
   {
      Print("ERROR: cannot read SYMBOL_TRADE_TICK_VALUE for risk sizing.");
      return INIT_FAILED;
   }
   if(InpRiskPercentMin <= 0.0 ||
      InpRiskPercentMax < InpRiskPercentMin ||
      InpRiskPercentMax > 10.0)
   {
      Print("ERROR: risk percentages must satisfy 0 < min <= max <= 10 (got ",
            DoubleToString(InpRiskPercentMin,2),"%-",
            DoubleToString(InpRiskPercentMax,2),"% ).");
      return INIT_FAILED;
   }
   if(InpMaxLot < minLot)
   {
      Print("ERROR: InpMaxLot ",DoubleToString(InpMaxLot,2),
            " is below symbol minimum ",DoubleToString(minLot,2),".");
      return INIT_FAILED;
   }

   g_lot = minLot;

   if(InpServerGMTOffsetHours == 999)
      g_serverOffsetSeconds = (int)(TimeTradeServer() - TimeGMT());
   else
      g_serverOffsetSeconds = InpServerGMTOffsetHours * 3600;

   g_atrHandle = iATR(_Symbol,PERIOD_M5,InpAtrPeriod);
   if(g_atrHandle == INVALID_HANDLE)
   {
      Print("ERROR: iATR failed, error=",GetLastError());
      return INIT_FAILED;
   }

   g_trade.SetExpertMagicNumber((ulong)InpMagic);
   g_trade.SetDeviationInPoints((ulong)InpSlippagePoints);
   if(!g_trade.SetTypeFillingBySymbol(_Symbol))
      Print("WARNING: could not auto-detect filling mode for ",_Symbol);

   long marginMode = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   g_hedging = (marginMode == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);

   Print("=== CRTbot Exness Sniper v1.005 ===");
   Print("Symbol=",_Symbol,
         " digits=",g_digits,
         " point=",DoubleToString(PointValue(),6),
         " tickSize=",DoubleToString(g_tickSize,6),
         " tickValue=",DoubleToString(g_tickValue,6));
   Print("MinLot=",DoubleToString(minLot,2),
         " step=",DoubleToString(step,2),
         " contract=",DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_TRADE_CONTRACT_SIZE),2),
         " riskPercent=",DoubleToString(InpRiskPercentMin,2),"-",
         DoubleToString(InpRiskPercentMax,2),
         " equity=",DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),2),
         " maxRiskUSD=",DoubleToString(MaxRiskUSD(),2),
         " maxLot=",DoubleToString(InpMaxLot,2),
         " skipLow=",InpSkipLowQuality,
         " APlusValidated=",InpAPlusValidated);
   Print("Spread now=",DoubleToString(CurrentSpreadPrice(),g_digits),
         " price points; max=",DoubleToString(g_maxSpread,2));
   Print("Server GMT offset=",IntegerToString(g_serverOffsetSeconds / 3600),
         "h; NY now=",TimeToString(NowNY(),TIME_DATE|TIME_MINUTES));
   Print("TradingEnabled=",InpTradingEnabled,
          " DemoOnly=",InpDemoOnly,
          " accountMode=",IntegerToString((int)AccountInfoInteger(ACCOUNT_TRADE_MODE)),
          " marginMode=",IntegerToString((int)marginMode),
          " (",(g_hedging ? "hedging" : "netting/exchange"),")");
   Print("TerminalTradeAllowed=",TerminalInfoInteger(TERMINAL_TRADE_ALLOWED),
         " EATradeAllowed=",MQLInfoInteger(MQL_TRADE_ALLOWED),
         " AccountTradeAllowed=",AccountInfoInteger(ACCOUNT_TRADE_ALLOWED));

   if(StringFind(_Symbol,"USTEC") < 0)
      Print("WARNING: this EA is designed for USTECm. Current symbol is ",_Symbol);

   if(InpTradingEnabled && InpDemoOnly &&
      !(bool)MQLInfoInteger(MQL_TESTER) &&
      (int)AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
      Print("WARNING: trading is enabled on a non-demo account; CanTrade() will block it.");

   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();

   if(reason == REASON_REMOVE || reason == REASON_CHARTCLOSE || reason == REASON_CLOSE)
   {
      DeletePendingOrders();
      Print("EA removed: pending orders cancelled. Open positions keep their SL/TP.");
   }

   if(g_atrHandle != INVALID_HANDLE)
      IndicatorRelease(g_atrHandle);
   Print("EA stopped. reason=",reason);
}

void OnTick()
{
   ProcessDay();
   ManagePositions();
}

void OnTimer()
{
   ProcessDay();
   ManagePositions();
}
//+------------------------------------------------------------------+


