import axios from "axios";

export const getChartData = (from, to) => {

  return axios.get(
    `http://localhost:8080/api/documents/chart/filter`,
    {
      params: { from, to }
    }
  );


  

};


